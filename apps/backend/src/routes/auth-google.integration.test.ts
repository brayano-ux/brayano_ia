import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = "123-abc.apps.googleusercontent.com";
  return { identity: { sub: "1098765", email: "awa@gmail.com", name: "Awa Ngono" } as { sub: string; email: string; name: string | null } | Error };
});
vi.mock("../auth/google.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../auth/google.js")>();
  return {
    ...original,
    verifyGoogleIdToken: async (_credential: string, clientId: string) => {
      if (clientId !== process.env.GOOGLE_CLIENT_ID) throw new original.GoogleAuthError("mauvais client");
      if (hoisted.identity instanceof Error) throw hoisted.identity;
      return hoisted.identity;
    },
  };
});

import type { FastifyInstance } from "fastify";
import { buildServer } from "../app.js";
import { GoogleAuthError } from "../auth/google.js";
import { resetRateLimitsForTests } from "../auth/rate-limit.js";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";

const CREDENTIAL = "header.payload.signature-de-google";

describe.skipIf(!integrationEnabled)("connexion avec Google (HTTP, base réelle)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildServer(); await app.ready(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => {
    await resetDatabase();
    resetRateLimitsForTests();
    hoisted.identity = { sub: "1098765", email: "awa@gmail.com", name: "Awa Ngono" };
  });

  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });

  it("donne l'identifiant client public au navigateur", async () => {
    const response = await app.inject({ method: "GET", url: "/auth/google/config" });
    expect(response.json()).toEqual({ clientId: "123-abc.apps.googleusercontent.com" });
  });

  it("nouvel utilisateur : ne demande que le nom de l'entreprise, puis crée l'espace avec l'essai gratuit", async () => {
    const first = await post("/auth/google", { credential: CREDENTIAL });
    expect(first.statusCode).toBe(200);
    const pending = first.json();
    expect(pending).toMatchObject({ signupRequired: true, email: "awa@gmail.com", name: "Awa Ngono" });
    expect(pending.token).toBeUndefined();
    expect(await prisma.user.count()).toBe(0);

    const done = await post("/auth/google/complete", { signupToken: pending.signupToken, companyName: "Boutique Awa" });
    expect(done.statusCode).toBe(200);
    const body = done.json();
    expect(body).toMatchObject({ organizationName: "Boutique Awa", user: { email: "awa@gmail.com" }, created: true });
    expect(body.token).toEqual(expect.any(String));

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "awa@gmail.com" }, include: { organization: true } });
    expect(user).toMatchObject({ name: "Awa Ngono", role: "ADMIN" });
    expect(user.organization).toMatchObject({ name: "Boutique Awa", freeAiResponsesRemaining: 100, whatsappNumber: null });
    expect(await prisma.aiSettings.count({ where: { organizationId: user.organizationId } })).toBe(1);

    // La session donnée fonctionne : le tableau de bord s'ouvre.
    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${body.token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ organizationId: user.organizationId });
  });

  it("compte existant avec le même email : connexion directe, sans nouvelle entreprise", async () => {
    const { organization } = await createTestOrganization("Salon Éclat", { email: "awa@gmail.com" });
    const response = await post("/auth/google", { credential: CREDENTIAL });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ organizationId: organization.id, user: { email: "awa@gmail.com" } });
    expect(response.json().token).toEqual(expect.any(String));
    expect(await prisma.organization.count()).toBe(1);
  });

  it("refuse un compte désactivé", async () => {
    const { user } = await createTestOrganization("Salon Éclat", { email: "awa@gmail.com" });
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await post("/auth/google", { credential: CREDENTIAL })).statusCode).toBe(403);
  });

  it("refuse un jeton Google invalide", async () => {
    hoisted.identity = new GoogleAuthError("Jeton Google : signature invalide.");
    const response = await post("/auth/google", { credential: CREDENTIAL });
    expect(response.statusCode).toBe(401);
    expect(response.json().message).toContain("signature invalide");
  });

  it("refuse un jeton d'inscription fabriqué ou un nom d'entreprise vide", async () => {
    expect((await post("/auth/google/complete", { signupToken: "eyJmYXV4Ijp0cnVlfQ.signature-inventee", companyName: "Boutique" })).statusCode).toBe(401);
    const { signupToken } = (await post("/auth/google", { credential: CREDENTIAL })).json();
    expect((await post("/auth/google/complete", { signupToken, companyName: " " })).statusCode).toBe(400);
    expect(await prisma.organization.count()).toBe(0);
  });

  it("un double envoi ne crée qu'une seule entreprise", async () => {
    const { signupToken } = (await post("/auth/google", { credential: CREDENTIAL })).json();
    await post("/auth/google/complete", { signupToken, companyName: "Boutique Awa" });
    const second = await post("/auth/google/complete", { signupToken, companyName: "Boutique Awa" });
    expect(second.statusCode).toBe(200);
    expect(await prisma.organization.count()).toBe(1);
  });
});
