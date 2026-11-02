import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../database/client.js";
import { env } from "../config/env.js";

const fetchMock = vi.fn();
const prismaMock = prisma as any;
const transactionMock = vi.hoisted(() => ({
  paymentUpdateMany: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  subscriptionUpsert: vi.fn(),
}));

vi.mock("../database/client.js", () => ({
  prisma: {
    billingPayment: {
      create: vi.fn(async () => ({ id: "payment-1" })),
      update: vi.fn(async () => ({})),
      findFirst: vi.fn(),
    },
    billingSubscription: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (callback) => callback({
      billingPayment: { updateMany: transactionMock.paymentUpdateMany },
      billingSubscription: {
        findUnique: transactionMock.subscriptionFindUnique,
        upsert: transactionMock.subscriptionUpsert,
      },
    })),
  },
}));

vi.mock("../config/env.js", () => ({
  env: {
    PAYMENT_PROVIDER: "campay",
    CAMPAY_BASE_URL: "https://demo.campay.net/api",
    CAMPAY_USERNAME: "test-user",
    CAMPAY_PASSWORD: "test-password",
    CAMPAY_CURRENCY: "XAF",
    CAMPAY_DEMO_AMOUNT: 25,
    CAMPAY_CALLBACK_URL: "https://app.example.com/billing/campay/callback",
    CHARIOW_API_KEY: "sk_test_chariow",
    APP_URL: "https://app.example.com",
  },
}));

const authMock = vi.hoisted(() => ({
  requireAuth: vi.fn(async (): Promise<{ email: string; organizationId: string; name: string } | null> => ({
    email: "client@example.com",
    organizationId: "org-1",
    name: "Awa Fouda",
  })),
}));
vi.mock("./auth.route.js", () => ({ requireAuth: authMock.requireAuth }));

describe("billing checkout route", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    env.CAMPAY_BASE_URL = "https://demo.campay.net/api";
    transactionMock.paymentUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    transactionMock.subscriptionFindUnique.mockReset().mockResolvedValue(null);
    transactionMock.subscriptionUpsert.mockReset().mockResolvedValue({});
  });

  it("creates a Campay collection request using env-configured credentials", async () => {
    const app = Fastify();
    const { billingRoute } = await import("./billing.route.js");
    await app.register(billingRoute);

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ token: "campay-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ reference: "campay-ref-123", ussd_code: "*126#" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/billing/create-checkout",
      payload: { plan: "pro", email: "client@example.com", phone: "237690000000" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({
      reference: "campay-ref-123",
      ussdCode: "*126#",
      chargedAmount: 25,
      currency: "XAF",
      demoMode: true,
      status: "PENDING",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/collect/");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      amount: "25",
      currency: "XAF",
    });
    expect(prismaMock.billingPayment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 25, currency: "XAF" }),
    }));

    vi.unstubAllGlobals();
  });

  it("activates the subscription only after Campay confirms amount and currency", async () => {
    env.CAMPAY_BASE_URL = "https://www.campay.net/api";
    const app = Fastify();
    const { billingRoute } = await import("./billing.route.js");
    await app.register(billingRoute);

    prismaMock.billingPayment.findFirst.mockResolvedValue({
      id: "payment-1",
      organizationId: "org-1",
      providerReference: "campay-ref-123",
      plan: "pro",
      amount: 20000,
      currency: "XAF",
      status: "PENDING",
    });
    fetchMock
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ token: "campay-token" }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ status: "SUCCESS", amount: "20000", currency: "XAF" }) });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/billing/campay/callback",
      payload: { reference: "campay-ref-123" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({ received: true, status: "SUCCESS" });
    expect(transactionMock.paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: "payment-1", status: "PENDING" },
      data: { status: "SUCCESS" },
    });
    expect(transactionMock.subscriptionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
      create: expect.objectContaining({ plan: "pro", messageLimit: 5000, status: "ACTIVE" }),
    }));

    vi.unstubAllGlobals();
  });

  it("does not activate a real subscription after a demo payment", async () => {
    const app = Fastify();
    const { billingRoute } = await import("./billing.route.js");
    await app.register(billingRoute);

    prismaMock.billingPayment.findFirst.mockResolvedValue({
      id: "payment-demo",
      organizationId: "org-1",
      providerReference: "campay-demo-ref",
      plan: "pro",
      amount: 25,
      currency: "XAF",
      status: "PENDING",
    });
    fetchMock
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ token: "campay-token" }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ status: "SUCCESS", amount: "25", currency: "XAF" }) });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/billing/campay/callback",
      payload: { reference: "campay-demo-ref" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({ received: true, status: "SUCCESS" });
    expect(transactionMock.paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: "payment-demo", status: "PENDING" },
      data: { status: "SUCCESS" },
    });
    expect(transactionMock.subscriptionUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("chariow checkout route", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    authMock.requireAuth.mockReset().mockResolvedValue({ email: "client@example.com", organizationId: "org-1", name: "Awa Fouda" });
  });

  it("démarre un paiement Chariow pour le forfait Essentiel avec la référence d'organisation en custom_metadata", async () => {
    const app = Fastify();
    const { billingRoute } = await import("./billing.route.js");
    await app.register(billingRoute);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ data: { payment: { checkout_url: "https://pay.chariow.com/abc" }, purchase: { id: "sal_abc123" } } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/billing/checkout/chariow",
      payload: { plan: "starter", phone: "6 90 00 00 00" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({ success: true, checkoutUrl: "https://pay.chariow.com/abc", plan: "starter" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.chariow.com/v1/checkout");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer sk_test_chariow" });
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      product_id: "prd_qe50o9mo",
      email: "client@example.com",
      first_name: "Awa",
      last_name: "Fouda",
      phone: { number: "690000000", country_code: "CM" },
      custom_metadata: { organization_id: "org-1" },
    });

    vi.unstubAllGlobals();
  });

  it("refuse un numéro qui n'est pas camerounais", async () => {
    const app = Fastify();
    const { billingRoute } = await import("./billing.route.js");
    await app.register(billingRoute);

    const response = await app.inject({
      method: "POST",
      url: "/billing/checkout/chariow",
      payload: { plan: "starter", phone: "+1 202 555 0147" },
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exige une session valide", async () => {
    authMock.requireAuth.mockResolvedValue(null);
    const app = Fastify();
    const { billingRoute } = await import("./billing.route.js");
    await app.register(billingRoute);

    const response = await app.inject({
      method: "POST",
      url: "/billing/checkout/chariow",
      payload: { plan: "starter", phone: "690000000" },
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("répond 503 quand Chariow refuse la demande de paiement", async () => {
    const app = Fastify();
    const { billingRoute } = await import("./billing.route.js");
    await app.register(billingRoute);

    fetchMock.mockResolvedValueOnce({ ok: false, text: async () => JSON.stringify({ message: "Produit introuvable." }) });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/billing/checkout/chariow",
      payload: { plan: "starter", phone: "690000000" },
    });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.payload).success).toBe(false);

    vi.unstubAllGlobals();
  });
});
