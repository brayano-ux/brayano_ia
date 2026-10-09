import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { SUPPORT_EMAIL: "support@example.com" as string | undefined, CLIENT_DASHBOARD_URL: "https://app.example.com" as string | undefined },
  orgFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  messageFindFirst: vi.fn(),
  sendEmail: vi.fn(),
  configured: vi.fn(),
  admins: vi.fn(),
}));
vi.mock("../config/env.js", () => ({ env: mocks.env }));
vi.mock("../database/client.js", () => ({
  prisma: { organization: { findUnique: mocks.orgFindUnique }, user: { findMany: mocks.userFindMany }, message: { findFirst: mocks.messageFindFirst } },
}));
vi.mock("./email.service.js", () => ({ sendEmail: mocks.sendEmail, isEmailConfigured: mocks.configured }));
vi.mock("../organizations/platform-admins.js", () => ({ getPlatformAdminEmails: mocks.admins }));

import {
  buildClientDisconnectEmail,
  formatDuration,
  buildDisconnectAlert,
  sendClientDisconnectEmail,
  sendClientRecoveredEmail,
  sendWhatsAppDisconnectAlert,
  sendWhatsAppRecoveredNotice,
} from "./whatsapp-alerts.js";

const SINCE = new Date("2026-10-09T08:00:00Z");
const outage = { organizationId: "org-1", status: "DISCONNECTED" as const, reason: "logged_out" as const, since: SINCE };

describe("formatDuration", () => {
  it("writes a readable duration", () => {
    expect(formatDuration(30_000)).toBe("1 minute");
    expect(formatDuration(7 * 60_000)).toBe("7 minutes");
    expect(formatDuration(135 * 60_000)).toBe("2 h 15 min");
    expect(formatDuration(3 * 3_600_000)).toBe("3 h");
    expect(formatDuration(27 * 3_600_000)).toBe("1 jour 3 h");
  });
});

describe("WhatsApp disconnection alert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.configured.mockReturnValue(true);
    mocks.admins.mockReturnValue(["owner@example.com"]);
    mocks.sendEmail.mockResolvedValue(true);
    mocks.orgFindUnique.mockResolvedValue({
      id: "org-1", name: "Boutique Zoé", createdAt: new Date("2026-09-01T10:00:00Z"), platformSuspended: false,
      whatsappAccounts: [{ phoneNumber: "237600000000" }],
    });
    mocks.userFindMany.mockResolvedValue([{ name: "Zoé Mballa", email: "zoe@example.com" }]);
    mocks.messageFindFirst.mockResolvedValue({ createdAt: new Date("2026-10-09T07:30:00Z") });
  });

  it("emails the owner the company details, the reason and what to do", async () => {
    await expect(sendWhatsAppDisconnectAlert(outage, SINCE.getTime() + 12 * 60_000)).resolves.toBe(1);
    const mail = mocks.sendEmail.mock.calls[0]![0];
    expect(mail.to).toBe("owner@example.com");
    expect(mail.subject).toBe("WhatsApp déconnecté : Boutique Zoé");
    for (const expected of ["depuis 12 minutes", "Boutique Zoé", "org-1", "+237600000000", "Zoé Mballa <zoe@example.com>", "Appareils liés", "Dernier message échangé", "IA suspendue par la plateforme : non", "onglet WhatsApp"]) {
      expect(mail.text).toContain(expected);
    }
  });

  it("adds the WhatsApp technical explanation to the owner email", () => {
    const text = buildDisconnectAlert(
      { id: "o", name: "X", createdAt: SINCE, phoneNumber: null, platformSuspended: false, lastMessageAt: null, admins: [] },
      { ...outage, reason: "connection_lost", detail: "Session ouverte ailleurs : un autre serveur utilise le même numéro (code 440)" },
      SINCE.getTime() + 600_000,
    ).text;
    expect(text).toContain("Détail WhatsApp : Session ouverte ailleurs");
    expect(text).toContain("(code 440)");
  });

  it("explains a lost connection differently from a logout", () => {
    const text = buildDisconnectAlert(
      { id: "o", name: "X", createdAt: SINCE, phoneNumber: null, platformSuspended: true, lastMessageAt: null, admins: [] },
      { ...outage, reason: "connection_lost", status: "QR_PENDING" },
      SINCE.getTime() + 3_600_000,
    ).text;
    expect(text).toContain("ne se rétablit pas toute seule");
    expect(text).toContain("en attente d'un scan de QR code");
    expect(text).toContain("aucun compte administrateur trouvé");
    expect(text).toContain("Numéro WhatsApp : inconnu");
    expect(text).toContain("suspendue par la plateforme : oui");
  });

  it("tells the owner when the number is back", async () => {
    await sendWhatsAppRecoveredNotice(outage, 25 * 60_000);
    const mail = mocks.sendEmail.mock.calls[0]![0];
    expect(mail.subject).toBe("WhatsApp reconnecté : Boutique Zoé");
    expect(mail.text).toContain("25 minutes");
  });

  it("warns instead of failing silently when SMTP is missing or nobody is configured", async () => {
    mocks.configured.mockReturnValue(false);
    await expect(sendWhatsAppDisconnectAlert(outage)).resolves.toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("SMTP non configuré"));
    mocks.configured.mockReturnValue(true);
    mocks.admins.mockReturnValue([]);
    await expect(sendWhatsAppDisconnectAlert(outage)).resolves.toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("PLATFORM_ADMIN_EMAILS"));
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("ignores an organization that no longer exists", async () => {
    mocks.orgFindUnique.mockResolvedValue(null);
    await expect(sendWhatsAppDisconnectAlert(outage)).resolves.toBe(0);
  });

  it("keeps going when one recipient is refused", async () => {
    mocks.admins.mockReturnValue(["a@example.com", "b@example.com"]);
    mocks.sendEmail.mockRejectedValueOnce(new Error("550")).mockResolvedValueOnce(true);
    await expect(sendWhatsAppDisconnectAlert(outage)).resolves.toBe(1);
  });
});

describe("email envoyé au client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.env.SUPPORT_EMAIL = "support@example.com";
    mocks.env.CLIENT_DASHBOARD_URL = "https://app.example.com";
    mocks.configured.mockReturnValue(true);
    mocks.sendEmail.mockResolvedValue(true);
    mocks.orgFindUnique.mockResolvedValue({
      id: "org-1", name: "Boutique Zoé", createdAt: new Date("2026-09-01T10:00:00Z"), platformSuspended: false,
      whatsappAccounts: [{ phoneNumber: "237600000000" }],
    });
    mocks.userFindMany.mockResolvedValue([{ name: "Zoé Mballa", email: "zoe@example.com" }, { name: "Paul", email: "paul@example.com" }]);
    mocks.messageFindFirst.mockResolvedValue(null);
  });

  it("writes to every administrator of the company with simple steps to reconnect", async () => {
    await expect(sendClientDisconnectEmail(outage, SINCE.getTime() + 5 * 60_000)).resolves.toBe(2);
    expect(mocks.sendEmail.mock.calls.map((call) => call[0].to)).toEqual(["zoe@example.com", "paul@example.com"]);
    const mail = mocks.sendEmail.mock.calls[0]![0];
    expect(mail.subject).toBe("Votre WhatsApp est déconnecté : votre assistant IA ne répond plus");
    for (const expected of ["Boutique Zoé", "depuis 5 minutes", "Appareils liés", "onglet WhatsApp", "« Connecter »", "https://app.example.com", "support@example.com"]) {
      expect(mail.text).toContain(expected);
    }
  });

  it("does not leak internal information to the client", () => {
    const { text } = buildClientDisconnectEmail(
      { id: "org-secret-id", name: "Boutique Zoé", createdAt: SINCE, phoneNumber: "237600000000", platformSuspended: false, lastMessageAt: SINCE, admins: [] },
      outage,
      SINCE.getTime() + 300_000,
    );
    expect(text).not.toContain("org-secret-id");
    expect(text).not.toContain("PLATFORM");
    expect(text).not.toContain("SMTP");
  });

  it("omits the optional links when they are not configured", () => {
    mocks.env.SUPPORT_EMAIL = undefined;
    mocks.env.CLIENT_DASHBOARD_URL = undefined;
    const { text } = buildClientDisconnectEmail(
      { id: "o", name: "X", createdAt: SINCE, phoneNumber: null, platformSuspended: false, lastMessageAt: null, admins: [] },
      { ...outage, reason: "connection_lost" },
      SINCE.getTime() + 300_000,
    );
    expect(text).not.toContain("tableau de bord :");
    expect(text).not.toContain("Besoin d'aide");
    expect(text).toContain("ne se rétablit pas toute seule");
  });

  it("does not nag a company whose AI is suspended by the platform", async () => {
    mocks.orgFindUnique.mockResolvedValue({
      id: "org-1", name: "Boutique Zoé", createdAt: SINCE, platformSuspended: true, whatsappAccounts: [{ phoneNumber: "237600000000" }],
    });
    await expect(sendClientDisconnectEmail(outage)).resolves.toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("warns instead of failing silently when there is nobody to write to or no SMTP", async () => {
    mocks.userFindMany.mockResolvedValue([]);
    await expect(sendClientDisconnectEmail(outage)).resolves.toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("aucun compte administrateur"));
    mocks.userFindMany.mockResolvedValue([{ name: "Zoé", email: "zoe@example.com" }]);
    mocks.configured.mockReturnValue(false);
    await expect(sendClientDisconnectEmail(outage)).resolves.toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("SMTP non configuré"));
  });

  it("keeps going when one recipient is refused", async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error("550")).mockResolvedValueOnce(true);
    await expect(sendClientDisconnectEmail(outage)).resolves.toBe(1);
  });

  it("tells the client when the number is connected again", async () => {
    await sendClientRecoveredEmail(outage);
    const mail = mocks.sendEmail.mock.calls[0]![0];
    expect(mail.subject).toBe("Votre WhatsApp est de nouveau connecté");
    expect(mail.text).toContain("Boutique Zoé");
  });
});
