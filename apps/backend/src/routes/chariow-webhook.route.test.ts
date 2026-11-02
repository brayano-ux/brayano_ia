import Fastify, { type FastifyRequest } from "fastify";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { CHARIOW_PULSE_SECRET: "whsec_test_secret" as string | undefined },
  deliveryCreate: vi.fn(),
  deliveryFindUnique: vi.fn(),
  deliveryUpdate: vi.fn(),
  orgFindUnique: vi.fn(),
  paymentCreate: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  subscriptionUpsert: vi.fn(),
}));
vi.mock("../config/env.js", () => ({ env: mocks.env }));
vi.mock("../database/client.js", () => ({
  prisma: {
    chariowPulseDelivery: { create: mocks.deliveryCreate, findUnique: mocks.deliveryFindUnique, update: mocks.deliveryUpdate },
    organization: { findUnique: mocks.orgFindUnique },
    billingPayment: { create: mocks.paymentCreate },
    billingSubscription: { findUnique: mocks.subscriptionFindUnique, upsert: mocks.subscriptionUpsert },
  },
}));

import { chariowWebhookRoute } from "./chariow-webhook.route.js";

const SECRET = "whsec_test_secret";
// Forfait "starter" (Essentiel) dans CHARIOW_PRODUCT_IDS (billing-plans.ts) : la vraie correspondance,
// pour vérifier que l'activation retrouve bien le forfait à partir du produit Chariow.
const STARTER_PRODUCT_ID = "prd_3x6444o4";

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Reproduit uniquement la part JSON du parseur de `app.ts`, qui pose `request.rawBody`. */
async function createApp() {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = Buffer.from(body as Buffer);
    done(null, {});
  });
  await app.register(chariowWebhookRoute);
  return app;
}

function post(app: Awaited<ReturnType<typeof createApp>>, body: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/billing/chariow/pulse",
    headers: { "content-type": "application/json", ...headers },
    payload: body,
  });
}

const VALID_HEADERS = { "x-pulse-delivery-id": "del-1", "x-pulse-id": "pulse-1", "x-pulse-event": "license.activated" };
const VALID_BODY = JSON.stringify({ sale: { id: "sale-1" } });

function successfulSaleBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    sale: { id: "sal_abc123", amount: { value: 10000, currency: "XAF" }, custom_metadata: { organization_id: "org-1" } },
    product: { id: STARTER_PRODUCT_ID },
    customer: { email: "client@example.com", phone: "+237690000000" },
    ...overrides,
  });
}

describe("POST /billing/chariow/pulse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.CHARIOW_PULSE_SECRET = SECRET;
    mocks.deliveryUpdate.mockResolvedValue({});
  });

  it("refuse si le secret du Pulse n'est pas configuré", async () => {
    mocks.env.CHARIOW_PULSE_SECRET = undefined;
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { "x-chariow-signature": sign(VALID_BODY), ...VALID_HEADERS });
      expect(response.statusCode).toBe(503);
      expect(mocks.deliveryCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse une signature manquante ou mal formée", async () => {
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { ...VALID_HEADERS });
      expect(response.statusCode).toBe(401);
      expect(mocks.deliveryCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse une signature dont le HMAC ne correspond pas au corps reçu", async () => {
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, {
        "x-chariow-signature": sign(VALID_BODY, "wrong_secret"),
        ...VALID_HEADERS,
      });
      expect(response.statusCode).toBe(401);
      expect(mocks.deliveryCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse une notification à laquelle il manque un en-tête Pulse", async () => {
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, {
        "x-chariow-signature": sign(VALID_BODY),
        "x-pulse-delivery-id": "del-1",
        "x-pulse-id": "pulse-1",
        // x-pulse-event manquant
      });
      expect(response.statusCode).toBe(400);
      expect(mocks.deliveryCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse un corps dont la signature est valide mais qui n'est pas du JSON", async () => {
    const body = "ceci n'est pas du json";
    const app = await createApp();
    try {
      const response = await post(app, body, { "x-chariow-signature": sign(body), ...VALID_HEADERS });
      expect(response.statusCode).toBe(400);
      expect(mocks.deliveryCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("refuse un JSON valide qui n'est pas un objet (ex. un tableau)", async () => {
    const body = JSON.stringify([1, 2, 3]);
    const app = await createApp();
    try {
      const response = await post(app, body, { "x-chariow-signature": sign(body), ...VALID_HEADERS });
      expect(response.statusCode).toBe(400);
      expect(mocks.deliveryCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("enregistre une notification valide (hors vente) et la marque traitée", async () => {
    mocks.deliveryCreate.mockResolvedValue({ id: "row-1", processedAt: null });
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { "x-chariow-signature": sign(VALID_BODY), ...VALID_HEADERS });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true, duplicate: false });
      expect(mocks.deliveryCreate).toHaveBeenCalledWith({
        data: { deliveryId: "del-1", pulseId: "pulse-1", event: "license.activated", payload: { sale: { id: "sale-1" } } },
      });
      expect(mocks.deliveryUpdate).toHaveBeenCalledWith({ where: { id: "row-1" }, data: { processedAt: expect.any(Date) } });
      expect(mocks.paymentCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("répond 200 sans ré-enregistrer quand une livraison déjà traitée est rejouée", async () => {
    mocks.deliveryCreate.mockRejectedValue(new Error("unique constraint failed"));
    mocks.deliveryFindUnique.mockResolvedValue({ id: "row-1", deliveryId: "del-1", processedAt: new Date() });
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { "x-chariow-signature": sign(VALID_BODY), ...VALID_HEADERS });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true, duplicate: true });
      expect(mocks.deliveryFindUnique).toHaveBeenCalledWith({ where: { deliveryId: "del-1" } });
      expect(mocks.paymentCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("répond 503 quand l'enregistrement échoue pour une vraie raison (pas un doublon)", async () => {
    mocks.deliveryCreate.mockRejectedValue(new Error("connexion base de données perdue"));
    mocks.deliveryFindUnique.mockResolvedValue(null);
    const app = await createApp();
    try {
      const response = await post(app, VALID_BODY, { "x-chariow-signature": sign(VALID_BODY), ...VALID_HEADERS });
      expect(response.statusCode).toBe(503);
      expect(response.json().received).toBe(false);
    } finally {
      await app.close();
    }
  });

  describe("activation de l'abonnement sur successful.sale", () => {
    const SALE_HEADERS = { "x-pulse-delivery-id": "del-sale", "x-pulse-id": "pulse-1", "x-pulse-event": "successful.sale" };

    it("active l'abonnement quand l'organisation, le produit et le paiement sont valides", async () => {
      const body = successfulSaleBody();
      mocks.deliveryCreate.mockResolvedValue({ id: "row-sale", processedAt: null });
      mocks.orgFindUnique.mockResolvedValue({ id: "org-1" });
      mocks.paymentCreate.mockResolvedValue({ id: "pay-1" });
      mocks.subscriptionFindUnique.mockResolvedValue(null);
      mocks.subscriptionUpsert.mockResolvedValue({});

      const app = await createApp();
      try {
        const response = await post(app, body, { "x-chariow-signature": sign(body), ...SALE_HEADERS });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ received: true, duplicate: false });

        expect(mocks.paymentCreate).toHaveBeenCalledWith({
          data: expect.objectContaining({
            organizationId: "org-1",
            providerReference: "sal_abc123",
            provider: "chariow",
            plan: "starter",
            amount: 10000,
            currency: "XAF",
            status: "SUCCESS",
          }),
        });
        expect(mocks.subscriptionUpsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { organizationId: "org-1" },
            create: expect.objectContaining({ organizationId: "org-1", plan: "starter", status: "ACTIVE" }),
          }),
        );
        expect(mocks.deliveryUpdate).toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it("prolonge l'abonnement à partir de sa date d'expiration actuelle (renouvellement anticipé)", async () => {
      const body = successfulSaleBody();
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      mocks.deliveryCreate.mockResolvedValue({ id: "row-sale", processedAt: null });
      mocks.orgFindUnique.mockResolvedValue({ id: "org-1" });
      mocks.paymentCreate.mockResolvedValue({ id: "pay-1" });
      mocks.subscriptionFindUnique.mockResolvedValue({ status: "ACTIVE", expiresAt: future });
      mocks.subscriptionUpsert.mockResolvedValue({});

      const app = await createApp();
      try {
        await post(app, body, { "x-chariow-signature": sign(body), ...SALE_HEADERS });
        const call = mocks.subscriptionUpsert.mock.calls[0]![0];
        expect(call.update.expiresAt.getTime()).toBe(future.getTime() + 30 * 24 * 60 * 60 * 1000);
        expect(call.update.periodStartedAt).toBeUndefined();
      } finally {
        await app.close();
      }
    });

    it("n'active rien et ne plante pas quand custom_metadata ne contient pas d'organisation", async () => {
      const body = successfulSaleBody({ sale: { id: "sal_abc123", amount: { value: 10000, currency: "XAF" }, custom_metadata: null } });
      mocks.deliveryCreate.mockResolvedValue({ id: "row-sale", processedAt: null });

      const app = await createApp();
      try {
        const response = await post(app, body, { "x-chariow-signature": sign(body), ...SALE_HEADERS });
        expect(response.statusCode).toBe(200);
        expect(mocks.paymentCreate).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it("n'active rien quand le produit ne correspond à aucun forfait Brayano", async () => {
      const body = successfulSaleBody({ product: { id: "prd_inconnu" } });
      mocks.deliveryCreate.mockResolvedValue({ id: "row-sale", processedAt: null });

      const app = await createApp();
      try {
        const response = await post(app, body, { "x-chariow-signature": sign(body), ...SALE_HEADERS });
        expect(response.statusCode).toBe(200);
        expect(mocks.orgFindUnique).not.toHaveBeenCalled();
        expect(mocks.paymentCreate).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it("n'active rien quand l'organisation référencée n'existe pas", async () => {
      const body = successfulSaleBody();
      mocks.deliveryCreate.mockResolvedValue({ id: "row-sale", processedAt: null });
      mocks.orgFindUnique.mockResolvedValue(null);

      const app = await createApp();
      try {
        const response = await post(app, body, { "x-chariow-signature": sign(body), ...SALE_HEADERS });
        expect(response.statusCode).toBe(200);
        expect(mocks.paymentCreate).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it("ne réétend pas l'abonnement quand cette vente a déjà été enregistrée (notification rejouée)", async () => {
      const body = successfulSaleBody();
      mocks.deliveryCreate.mockResolvedValue({ id: "row-sale", processedAt: null });
      mocks.orgFindUnique.mockResolvedValue({ id: "org-1" });
      mocks.paymentCreate.mockRejectedValue(new Error("unique constraint failed on provider_reference"));

      const app = await createApp();
      try {
        const response = await post(app, body, { "x-chariow-signature": sign(body), ...SALE_HEADERS });
        expect(response.statusCode).toBe(200);
        expect(mocks.subscriptionUpsert).not.toHaveBeenCalled();
        expect(mocks.deliveryUpdate).toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it("réessaie l'activation (sans réenregistrer la livraison) si une tentative précédente ne l'avait pas terminée", async () => {
      const body = successfulSaleBody();
      mocks.deliveryCreate.mockRejectedValue(new Error("unique constraint failed"));
      mocks.deliveryFindUnique.mockResolvedValue({ id: "row-sale", deliveryId: "del-sale", processedAt: null });
      mocks.orgFindUnique.mockResolvedValue({ id: "org-1" });
      mocks.paymentCreate.mockResolvedValue({ id: "pay-1" });
      mocks.subscriptionFindUnique.mockResolvedValue(null);
      mocks.subscriptionUpsert.mockResolvedValue({});

      const app = await createApp();
      try {
        const response = await post(app, body, { "x-chariow-signature": sign(body), ...SALE_HEADERS });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ received: true, duplicate: false });
        expect(mocks.paymentCreate).toHaveBeenCalled();
        expect(mocks.subscriptionUpsert).toHaveBeenCalled();
        expect(mocks.deliveryUpdate).toHaveBeenCalledWith({ where: { id: "row-sale" }, data: { processedAt: expect.any(Date) } });
      } finally {
        await app.close();
      }
    });

    it("répond 503 et ne marque pas la livraison traitée quand l'activation échoue pour une vraie raison", async () => {
      const body = successfulSaleBody();
      mocks.deliveryCreate.mockResolvedValue({ id: "row-sale", processedAt: null });
      mocks.orgFindUnique.mockRejectedValue(new Error("connexion base de données perdue"));

      const app = await createApp();
      try {
        const response = await post(app, body, { "x-chariow-signature": sign(body), ...SALE_HEADERS });
        expect(response.statusCode).toBe(503);
        expect(mocks.deliveryUpdate).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });
});
