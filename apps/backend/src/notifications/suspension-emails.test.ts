import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  orgFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  sendEmail: vi.fn(),
  env: { SUPPORT_EMAIL: "support@example.com" as string | undefined },
}));
vi.mock("../config/env.js", () => ({ env: mocks.env }));
vi.mock("../database/client.js", () => ({
  prisma: { organization: { findUnique: mocks.orgFindUnique }, user: { findMany: mocks.userFindMany } },
}));
vi.mock("./email.service.js", () => ({ sendEmail: mocks.sendEmail, isEmailConfigured: mocks.configured }));

import { sendSuspensionEmail } from "./suspension-emails.js";

describe("sendSuspensionEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.configured.mockReturnValue(true);
    mocks.orgFindUnique.mockResolvedValue({ name: "Boutique Zoé" });
    mocks.userFindMany.mockResolvedValue([{ email: "a@example.com" }, { email: "b@example.com" }]);
    mocks.sendEmail.mockResolvedValue(true);
  });

  it("sends the suspension notice with the reason to every administrator", async () => {
    await expect(sendSuspensionEmail("org-1", "suspended", "Impayé")).resolves.toEqual({ status: "sent", sent: 2, total: 2 });
    expect(mocks.userFindMany).toHaveBeenCalledWith({ where: { organizationId: "org-1", role: "ADMIN" }, select: { email: true } });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    const first = mocks.sendEmail.mock.calls[0]![0];
    expect(first.to).toBe("a@example.com");
    expect(first.subject).toMatch(/suspendu/);
    expect(first.text).toContain("Boutique Zoé");
    expect(first.text).toContain("Motif : Impayé");
    expect(first.text).toContain("support@example.com");
  });

  it("sends the reactivation notice", async () => {
    await sendSuspensionEmail("org-1", "reactivated", null);
    expect(mocks.sendEmail.mock.calls[0]![0].subject).toMatch(/de nouveau actif/);
  });

  it("reports a missing SMTP configuration instead of failing silently", async () => {
    mocks.configured.mockReturnValue(false);
    await expect(sendSuspensionEmail("org-1", "suspended", null)).resolves.toEqual({ status: "smtp_not_configured", sent: 0, total: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("SMTP non configuré"));
  });

  it("reports a partial delivery", async () => {
    mocks.sendEmail.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("boom"));
    await expect(sendSuspensionEmail("org-1", "suspended", null)).resolves.toEqual({ status: "partial", sent: 1, total: 2 });
  });

  it("reports a failure when the mail server refuses everything", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("535 auth failed"));
    await expect(sendSuspensionEmail("org-1", "suspended", null)).resolves.toEqual({ status: "failed", sent: 0, total: 2 });
  });

  it("reports when the organization has no administrator account", async () => {
    mocks.userFindMany.mockResolvedValue([]);
    await expect(sendSuspensionEmail("org-1", "suspended", null)).resolves.toEqual({ status: "no_admin", sent: 0, total: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
