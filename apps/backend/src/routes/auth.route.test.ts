import Fastify from "fastify";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../database/client.js";

vi.mock("../database/client.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    signupVerification: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    passwordResetVerification: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(async (callback) => callback({
      organization: { create: vi.fn() },
      user: { create: vi.fn() },
      aiSettings: { create: vi.fn() },
      signupVerification: { delete: vi.fn() },
    })),
  },
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({}),
    })),
  },
}));

import { getConfiguredAdminCredentials, verifyPassword } from "./auth.route.js";

const prismaMock = prisma as any;

const originalDefaults = {
  DEFAULT_ADMIN_EMAIL: process.env.DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD: process.env.DEFAULT_ADMIN_PASSWORD,
};

afterEach(() => {
  if (originalDefaults.DEFAULT_ADMIN_EMAIL === undefined) delete process.env.DEFAULT_ADMIN_EMAIL;
  else process.env.DEFAULT_ADMIN_EMAIL = originalDefaults.DEFAULT_ADMIN_EMAIL;

  if (originalDefaults.DEFAULT_ADMIN_PASSWORD === undefined) delete process.env.DEFAULT_ADMIN_PASSWORD;
  else process.env.DEFAULT_ADMIN_PASSWORD = originalDefaults.DEFAULT_ADMIN_PASSWORD;
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "user@example.com";
  process.env.SMTP_PASSWORD = "secret";
  process.env.SMTP_FROM = "noreply@example.com";
});

describe("auth security configuration", () => {
  it("does not expose a hardcoded default admin when no explicit admin is configured", () => {
    delete process.env.DEFAULT_ADMIN_EMAIL;
    delete process.env.DEFAULT_ADMIN_PASSWORD;

    expect(getConfiguredAdminCredentials()).toBeNull();
  });

  it("verifies a configured admin password with a constant-time hash check", () => {
    process.env.DEFAULT_ADMIN_EMAIL = "admin@brayano.ai";
    process.env.DEFAULT_ADMIN_PASSWORD = "brayano123";

    expect(getConfiguredAdminCredentials()).toMatchObject({
      email: "admin@brayano.ai",
      password: "brayano123",
    });

    const expectedHash = createHash("sha256").update("brayano123").digest("hex");
    expect(verifyPassword("brayano123", expectedHash)).toBe(true);
    expect(verifyPassword("wrong-pass", expectedHash)).toBe(false);
  });

  it("allows an unlisted email to start signup but creates the account only after code verification", async () => {
    const app = Fastify();
    const { authRoute } = await import("./auth.route.js");
    await app.register(authRoute);
    const organizationCreate = vi.fn(async ({ data }: any) => {
      expect(data).toMatchObject({ name: "Example company", whatsappNumber: "237690000000", freeAiResponsesRemaining: 15 });
      return { id: "org-trial", name: data.name };
    });
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.signupVerification.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        email: "new.person@example.com",
        name: "Example Owner",
        companyName: "Example company",
        whatsappNumber: "237690000000",
        passwordHash: "password-hash",
        codeHash: createHash("sha256").update("123456").digest("hex"),
        expiresAt: new Date(Date.now() + 600_000),
        attempts: 0,
      });

    const signupResponse = await app.inject({
      method: "POST",
      url: "/register",
      payload: {
        name: "Example Owner",
        companyName: "Example company",
        whatsappNumber: "+237 690 00 00 00",
        email: "new.person@example.com",
        password: "StrongPassword123",
      },
    });

    expect(signupResponse.statusCode).toBe(200);
    expect(JSON.parse(signupResponse.payload)).toMatchObject({ verificationRequired: true, email: "new.person@example.com" });
    expect(prismaMock.signupVerification.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ whatsappNumber: "237690000000" }) }));
    expect(organizationCreate).not.toHaveBeenCalled();

    prismaMock.$transaction.mockImplementationOnce(async (callback: any) => callback({
      organization: { create: organizationCreate },
      user: { create: vi.fn(async () => ({ id: "user-trial" })) },
      aiSettings: { create: vi.fn() },
      signupVerification: { delete: vi.fn() },
    }));
    const verifyResponse = await app.inject({
      method: "POST",
      url: "/register/verify",
      payload: { email: "new.person@example.com", code: "123456" },
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(JSON.parse(verifyResponse.payload)).toMatchObject({ organizationId: "org-trial", user: { email: "new.person@example.com" } });
    expect(organizationCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["absent", undefined],
    ["trop court", "12345"],
    ["avec des lettres", "+237 69a 00 00 00"],
  ])("refuse l'inscription quand le numéro WhatsApp est %s", async (_label, whatsappNumber) => {
    const app = Fastify();
    const { authRoute } = await import("./auth.route.js");
    await app.register(authRoute);

    const response = await app.inject({
      method: "POST",
      url: "/register",
      headers: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200)}` },
      payload: { name: "Example Owner", companyName: "Example company", email: "no.number@example.com", password: "StrongPassword123", ...(whatsappNumber ? { whatsappNumber } : {}) },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).message).toMatch(/WhatsApp/);
    expect(prismaMock.signupVerification.upsert).not.toHaveBeenCalled();
  });

  it("requires email verification for the former hardcoded admin address too", async () => {
    const app = Fastify();
    const { authRoute } = await import("./auth.route.js");
    await app.register(authRoute);
    prismaMock.signupVerification.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/register",
      headers: { "x-forwarded-for": "192.0.2.55" },
      payload: {
        name: "Admin Owner",
        companyName: "Admin Company",
        whatsappNumber: "690000000",
        email: "admin@brayano.ai",
        password: "StrongPassword123",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({ verificationRequired: true, email: "admin@brayano.ai" });
  });

  it("sends a password-reset code for an existing user and allows resetting the password", async () => {
    const app = Fastify();
    const { authRoute } = await import("./auth.route.js");
    await app.register(authRoute);

    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      organizationId: "org-1",
    });
    prismaMock.passwordResetVerification.upsert.mockResolvedValue({});

    const requestResponse = await app.inject({
      method: "POST",
      url: "/password-reset/request",
      payload: { email: "user@example.com" },
    });

    expect(requestResponse.statusCode).toBe(200);
    expect(JSON.parse(requestResponse.payload).message).toContain("code");
    expect(prismaMock.passwordResetVerification.upsert).toHaveBeenCalled();

    const fakeCode = "123456";
    prismaMock.passwordResetVerification.findUnique.mockResolvedValue({
      email: "user@example.com",
      codeHash: createHash("sha256").update(fakeCode).digest("hex"),
      expiresAt: new Date(Date.now() + 600_000),
      lastSentAt: new Date(),
      attempts: 0,
    });
    prismaMock.user.update.mockResolvedValue({ id: "user-1", email: "user@example.com" });

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/password-reset/verify",
      payload: {
        email: "user@example.com",
        code: fakeCode,
        newPassword: "MyNewPassword123",
      },
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(JSON.parse(verifyResponse.payload).message).toContain("réinitialisé");
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: "user@example.com" },
      data: expect.objectContaining({ passwordHash: expect.any(String) }),
    }));
  });
});
