import Fastify from "fastify";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: { findUnique: vi.fn(), delete: vi.fn(), upsert: vi.fn() }, user: { findUnique: vi.fn() } }));
vi.mock("../database/client.js", () => ({ prisma: mocks }));
import { authRoute, getSessionFromToken, hashPassword, requireAuth } from "./auth.route.js";

const activeSession = () => ({ email: "owner@example.test", organizationId: "org-1", expiresAt: new Date(Date.now() + 60_000), user: { id: "user-1", name: "Owner", organizationId: "org-1", role: "ADMIN", active: true } });

beforeEach(() => { vi.resetAllMocks(); });

describe("persistent authentication sessions", () => {
  it("requires a bearer token and verifies its hash", async () => {
    expect(await requireAuth(undefined)).toBeNull();
    expect(mocks.session.findUnique).not.toHaveBeenCalled();
    mocks.session.findUnique.mockResolvedValue(activeSession());
    expect(await requireAuth("Bearer demo-token")).toMatchObject({ organizationId: "org-1", userId: "user-1" });
    expect(mocks.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: createHash("sha256").update("demo-token").digest("hex") } }));
  });

  it("rejects an unknown token", async () => {
    mocks.session.findUnique.mockResolvedValue(null);
    expect(await getSessionFromToken("unknown")).toBeNull();
  });

  it("rejects an expired session", async () => {
    mocks.session.findUnique.mockResolvedValue({ ...activeSession(), expiresAt: new Date(0) });
    mocks.session.delete.mockResolvedValue({});
    expect(await getSessionFromToken("expired")).toBeNull();
    expect(mocks.session.delete).toHaveBeenCalledOnce();
  });

  it("rejects a deactivated employee", async () => {
    const session = activeSession(); session.user.active = false;
    mocks.session.findUnique.mockResolvedValue(session);
    expect(await getSessionFromToken("disabled")).toBeNull();
  });

  it("reports a database failure as unavailable rather than an invalid session", async () => {
    mocks.session.findUnique.mockRejectedValue(new Error("database unavailable"));
    await expect(getSessionFromToken("valid-but-db-down")).rejects.toMatchObject({ statusCode: 503, code: "AUTH_UNAVAILABLE" });
  });

  it("never returns a login token if its persistence fails", async () => {
    mocks.user.findUnique.mockResolvedValue({ id: "user-1", organizationId: "org-1", active: true, passwordHash: hashPassword("password123") });
    mocks.session.upsert.mockRejectedValue(new Error("database unavailable"));
    const app = Fastify(); await app.register(authRoute);
    try {
      const response = await app.inject({ method: "POST", url: "/login", headers: { "x-forwarded-for": "192.0.2.90" }, payload: { email: "owner@example.test", password: "password123" } });
      expect(response.statusCode).toBe(503);
      expect(response.json().token).toBeUndefined();
    } finally { await app.close(); }
  });
});
