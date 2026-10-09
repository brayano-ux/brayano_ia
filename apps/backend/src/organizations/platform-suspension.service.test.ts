import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn(), sendEmail: vi.fn() }));
vi.mock("../database/client.js", () => ({
  prisma: { organization: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));
vi.mock("../notifications/suspension-emails.js", () => ({ sendSuspensionEmail: mocks.sendEmail }));

import { getPlatformSuspension, suspendOrganization, unsuspendOrganization } from "./platform-suspension.service.js";

describe("getPlatformSuspension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("reports a suspended organization with its reason", async () => {
    const suspendedAt = new Date();
    mocks.findUnique.mockResolvedValue({ platformSuspended: true, suspensionReason: "Impayé", suspendedAt });
    await expect(getPlatformSuspension("org-1")).resolves.toEqual({ suspended: true, reason: "Impayé", suspendedAt });
  });

  it("treats an unknown organization as not suspended", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(getPlatformSuspension("org-1")).resolves.toEqual({ suspended: false, reason: null, suspendedAt: null });
  });

  it("lets the AI answer when the database lookup fails", async () => {
    mocks.findUnique.mockRejectedValue(new Error('column "platform_suspended" does not exist'));
    await expect(getPlatformSuspension("org-1")).resolves.toEqual({ suspended: false, reason: null, suspendedAt: null });
  });
});

describe("suspension changes and notifications", () => {
  const sent = { status: "sent", sent: 2, total: 2 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.sendEmail.mockResolvedValue(sent);
  });

  it("emails the administrators when an organization becomes suspended and reports the result", async () => {
    mocks.findUnique.mockResolvedValue({ platformSuspended: false });
    const result = await suspendOrganization("org-1", "Impayé");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "org-1" },
      data: expect.objectContaining({ platformSuspended: true, suspensionReason: "Impayé" }),
    }));
    expect(mocks.sendEmail).toHaveBeenCalledWith("org-1", "suspended", "Impayé");
    expect(result).toEqual({ notification: sent });
  });

  it("does not email again when the organization is already suspended", async () => {
    mocks.findUnique.mockResolvedValue({ platformSuspended: true });
    const result = await suspendOrganization("org-1", "Nouveau motif");
    expect(mocks.updateMany).toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ notification: null });
  });

  it("emails the administrators when the suspension is lifted", async () => {
    mocks.findUnique.mockResolvedValue({ platformSuspended: true });
    const result = await unsuspendOrganization("org-1");
    expect(mocks.sendEmail).toHaveBeenCalledWith("org-1", "reactivated", null);
    expect(result).toEqual({ notification: sent });
  });

  it("does not email when lifting a suspension that did not exist", async () => {
    mocks.findUnique.mockResolvedValue({ platformSuspended: false });
    await expect(unsuspendOrganization("org-1")).resolves.toEqual({ notification: null });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("still succeeds and reports a failure when the email cannot be sent", async () => {
    mocks.findUnique.mockResolvedValue({ platformSuspended: false });
    mocks.sendEmail.mockRejectedValue(new Error("SMTP down"));
    await expect(suspendOrganization("org-1", null)).resolves.toEqual({ notification: { status: "failed", sent: 0, total: 0 } });
    expect(mocks.updateMany).toHaveBeenCalled();
  });

  it("does not wait forever for a slow mail server", async () => {
    vi.useFakeTimers();
    try {
      mocks.findUnique.mockResolvedValue({ platformSuspended: false });
      mocks.sendEmail.mockReturnValue(new Promise(() => undefined));
      const pending = suspendOrganization("org-1", null);
      await vi.advanceTimersByTimeAsync(8001);
      await expect(pending).resolves.toEqual({ notification: { status: "pending", sent: 0, total: 0 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an unknown organization", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(suspendOrganization("missing", null)).rejects.toThrow("Entreprise introuvable.");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
