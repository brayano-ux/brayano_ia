import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { runWhatsAppConnectReminders } from "./whatsapp-connect-reminders.js";

const NOW = new Date("2026-11-18T09:00:00Z"); // 10 h à Douala
const DAY = 24 * 3_600_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.skipIf(!integrationEnabled)("rappels « connectez votre WhatsApp » (base réelle)", () => {
  let sent: Array<{ organizationId: string; subject: string }>;
  const notify = async (organizationId: string, build: (name: string) => { subject: string; text: string }) => {
    sent.push({ organizationId, subject: build("Entreprise").subject });
  };

  beforeEach(async () => {
    await resetDatabase();
    sent = [];
  });
  afterAll(async () => { await disconnectTestDatabase(); });

  async function organizationCreated(days: number, name = "Boutique") {
    const { organization } = await createTestOrganization(name);
    await prisma.organization.update({ where: { id: organization.id }, data: { createdAt: daysAgo(days) } });
    return organization;
  }

  it("prévient une seule fois un compte créé hier sans WhatsApp relié", async () => {
    const organization = await organizationCreated(1.5);
    expect(await runWhatsAppConnectReminders({ now: NOW, notify })).toBe(1);
    expect(await runWhatsAppConnectReminders({ now: NOW, notify })).toBe(0);
    expect(sent).toEqual([{ organizationId: organization.id, subject: expect.stringContaining("Dernière étape") }]);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).toMatchObject({ whatsappReminderCount: 1 });
  });

  it("envoie le deuxième rappel après 3 jours", async () => {
    const organization = await organizationCreated(3.5);
    await prisma.organization.update({ where: { id: organization.id }, data: { whatsappReminderCount: 1 } });
    await runWhatsAppConnectReminders({ now: NOW, notify });
    expect(sent.map((email) => email.subject)).toEqual([expect.stringContaining("Vos clients vous écrivent")]);
  });

  it("ne prévient pas un compte dont le WhatsApp est connecté, ou l'a déjà été", async () => {
    const connected = await organizationCreated(1.5, "Connectée");
    await prisma.whatsAppAccount.create({ data: { organizationId: connected.id, status: "CONNECTED" } });
    const once = await organizationCreated(1.5, "Déjà reliée");
    await prisma.whatsAppAccount.create({ data: { organizationId: once.id, status: "DISCONNECTED", lastConnectedAt: daysAgo(1) } });
    const never = await organizationCreated(1.5, "Jamais reliée");
    await prisma.whatsAppAccount.create({ data: { organizationId: never.id, status: "QR_PENDING" } });

    await runWhatsAppConnectReminders({ now: NOW, notify });
    expect(sent.map((email) => email.organizationId)).toEqual([never.id]);
  });

  it("ignore les comptes trop récents, trop anciens ou suspendus", async () => {
    await organizationCreated(0.5, "Trop récente");
    await organizationCreated(30, "Ancienne");
    const suspended = await organizationCreated(1.5, "Suspendue");
    await prisma.organization.update({ where: { id: suspended.id }, data: { platformSuspended: true } });
    expect(await runWhatsAppConnectReminders({ now: NOW, notify })).toBe(0);
  });

  it("n'envoie rien la nuit", async () => {
    await organizationCreated(1.5);
    expect(await runWhatsAppConnectReminders({ now: new Date("2026-11-18T23:00:00Z"), notify })).toBe(0);
    expect(sent).toEqual([]);
  });
});
