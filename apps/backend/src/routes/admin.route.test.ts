import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suspend: vi.fn(),
  unsuspend: vi.fn(),
  list: vi.fn(),
  requireAuth: vi.fn(),
  env: {
    PLATFORM_ADMIN_TOKEN: "t".repeat(40) as string | undefined,
    PLATFORM_ADMIN_EMAILS: "" as string | undefined,
    DEFAULT_ADMIN_EMAIL: "" as string | undefined,
  },
}));

vi.mock("../config/env.js", () => ({ env: mocks.env }));
vi.mock("../whatsapp/whatsapp.registry.js", () => ({ getWhatsAppAccountStatus: vi.fn((id: string) => (id === "org-1" ? "CONNECTED" : "DISCONNECTED")) }));
vi.mock("./auth.route.js", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("../organizations/platform-suspension.service.js", () => ({
  suspendOrganization: mocks.suspend,
  unsuspendOrganization: mocks.unsuspend,
  listOrganizationsForAdmin: mocks.list,
}));

import { adminRoute } from "./admin.route.js";

const auth = { authorization: `Bearer ${"t".repeat(40)}` };

async function buildApp() {
  const app = Fastify();
  await app.register(adminRoute);
  return app;
}

describe("platform admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.PLATFORM_ADMIN_TOKEN = "t".repeat(40);
    mocks.env.PLATFORM_ADMIN_EMAILS = "";
    mocks.env.DEFAULT_ADMIN_EMAIL = "";
    mocks.requireAuth.mockResolvedValue(null);
    mocks.suspend.mockResolvedValue({ notification: { status: "sent", sent: 2, total: 2 } });
    mocks.unsuspend.mockResolvedValue({ notification: null });
  });

  it("rejects requests without the platform token", async () => {
    const app = await buildApp();
    const none = await app.inject({ method: "POST", url: "/admin/organizations/org-1/suspend" });
    const wrong = await app.inject({ method: "POST", url: "/admin/organizations/org-1/suspend", headers: { authorization: "Bearer nope" } });
    expect(none.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(mocks.suspend).not.toHaveBeenCalled();
  });

  it("is disabled when neither a token nor an admin email is configured", async () => {
    mocks.env.PLATFORM_ADMIN_TOKEN = undefined;
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/admin/organizations", headers: auth });
    expect(response.statusCode).toBe(503);
  });

  it("suspends and unsuspends an organization", async () => {
    const app = await buildApp();
    const suspended = await app.inject({
      method: "POST", url: "/admin/organizations/org-1/suspend", headers: auth, payload: { reason: "Impayé" },
    });
    expect(suspended.statusCode).toBe(200);
    expect(JSON.parse(suspended.payload)).toMatchObject({ platformSuspended: true, notification: { status: "sent", sent: 2, total: 2 } });
    expect(mocks.suspend).toHaveBeenCalledWith("org-1", "Impayé");

    const restored = await app.inject({ method: "POST", url: "/admin/organizations/org-1/unsuspend", headers: auth });
    expect(restored.statusCode).toBe(200);
    expect(mocks.unsuspend).toHaveBeenCalledWith("org-1");
  });

  it("lists organizations with their live WhatsApp status and disconnection history", async () => {
    const updatedAt = "2026-10-09T08:00:00.000Z";
    const history = { lastConnectedAt: updatedAt, lastDisconnectedAt: "2026-10-09T07:00:00.000Z", lastDisconnectReason: "Session ouverte ailleurs (code 440)" };
    mocks.list.mockResolvedValue([
      { id: "org-1", platformSuspended: true, whatsappAccounts: [{ status: "CONNECTED", phoneNumber: "237600000000", updatedAt, ...history }] },
      { id: "org-2", platformSuspended: false, whatsappAccounts: [] },
    ]);
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/admin/organizations", headers: auth });
    expect(JSON.parse(response.payload)).toEqual({
      organizations: [
        { id: "org-1", platformSuspended: true, whatsapp: { status: "CONNECTED", phoneNumber: "237600000000", updatedAt, ...history } },
        {
          id: "org-2",
          platformSuspended: false,
          whatsapp: { status: "DISCONNECTED", phoneNumber: null, updatedAt: null, lastConnectedAt: null, lastDisconnectedAt: null, lastDisconnectReason: null },
        },
      ],
    });
  });

  it("accepts the session of a listed admin email, case-insensitively", async () => {
    mocks.env.PLATFORM_ADMIN_TOKEN = undefined;
    mocks.env.PLATFORM_ADMIN_EMAILS = " Owner@Example.com , other@example.com";
    mocks.requireAuth.mockResolvedValue({ email: "owner@example.com", organizationId: "org-1" });
    mocks.list.mockResolvedValue([]);
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/admin/organizations", headers: { authorization: "Bearer session-token" } });
    expect(response.statusCode).toBe(200);
  });

  it("falls back to DEFAULT_ADMIN_EMAIL when PLATFORM_ADMIN_EMAILS is empty", async () => {
    mocks.env.PLATFORM_ADMIN_TOKEN = undefined;
    mocks.env.DEFAULT_ADMIN_EMAIL = "admin@example.com";
    mocks.requireAuth.mockResolvedValue({ email: "admin@example.com", organizationId: "org-1" });
    mocks.list.mockResolvedValue([]);
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/admin/organizations", headers: { authorization: "Bearer session-token" } });
    expect(response.statusCode).toBe(200);
  });

  it("rejects a valid session of a non-admin company account with 403", async () => {
    mocks.env.PLATFORM_ADMIN_TOKEN = undefined;
    mocks.env.PLATFORM_ADMIN_EMAILS = "owner@example.com";
    mocks.requireAuth.mockResolvedValue({ email: "client@example.com", organizationId: "org-2" });
    const app = await buildApp();
    const response = await app.inject({ method: "POST", url: "/admin/organizations/org-1/suspend", headers: { authorization: "Bearer session-token" } });
    expect(response.statusCode).toBe(403);
    expect(mocks.suspend).not.toHaveBeenCalled();
  });

  it("rejects an unknown session with 401", async () => {
    mocks.env.PLATFORM_ADMIN_TOKEN = undefined;
    mocks.env.PLATFORM_ADMIN_EMAILS = "owner@example.com";
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/admin/organizations", headers: { authorization: "Bearer nope" } });
    expect(response.statusCode).toBe(401);
  });
});
