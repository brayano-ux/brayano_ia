import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { getDashboardStats } from "./stats.service.js";

// Mercredi 14 octobre 2026, 12:00 UTC = 13:00 à Douala (UTC+1).
const NOW = new Date("2026-10-14T12:00:00Z");

async function seed(organizationId: string) {
  const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: "237655000001@s.whatsapp.net" } });
  const conversation = await prisma.conversation.create({ data: { organizationId, contactId: contact.id, createdAt: new Date("2026-10-13T09:00:00Z"), stage: "INTERESTED" } });
  const message = (direction: "INBOUND" | "OUTBOUND", author: "CONTACT" | "AI" | "HUMAN", at: string, aiMeta?: object) =>
    prisma.message.create({ data: { conversationId: conversation.id, direction, author, type: "TEXT", content: "x", createdAt: new Date(at), ...(aiMeta ? { aiMeta } : {}) } });
  await message("INBOUND", "CONTACT", "2026-10-13T09:00:00Z"); // mardi 10:00 local
  await message("OUTBOUND", "AI", "2026-10-13T09:00:05Z");
  await message("INBOUND", "CONTACT", "2026-10-13T21:30:00Z"); // mardi 22:30 local : hors horaires
  await message("OUTBOUND", "AI", "2026-10-13T21:30:05Z", { needsHuman: true });
  await message("OUTBOUND", "HUMAN", "2026-10-14T08:00:00Z");
  await message("INBOUND", "CONTACT", "2026-10-14T09:00:00Z"); // mercredi 10:00 local
  await message("OUTBOUND", "AI", "2026-10-14T09:00:05Z");
  await message("INBOUND", "CONTACT", "2026-09-01T09:00:00Z"); // hors période
  await prisma.order.create({ data: { organizationId, conversationId: conversation.id, customerName: "A", deliveryAddress: "x", items: [], total: 7000, paymentStatus: "PAID", createdAt: new Date("2026-10-14T10:00:00Z") } });
  await prisma.order.create({ data: { organizationId, conversationId: conversation.id, customerName: "B", deliveryAddress: "x", items: [], total: 3000, createdAt: new Date("2026-10-13T10:00:00Z") } });
  await prisma.order.create({ data: { organizationId, conversationId: conversation.id, customerName: "C", deliveryAddress: "x", items: [], total: 9999, status: "CANCELLED", createdAt: new Date("2026-10-13T10:00:00Z") } });
  await prisma.appointment.create({ data: { organizationId, startsAt: new Date("2026-10-20T09:00:00Z"), endsAt: new Date("2026-10-20T09:30:00Z"), createdAt: new Date("2026-10-13T12:00:00Z") } });
}

describe.skipIf(!integrationEnabled)("statistiques du tableau de bord (base réelle)", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await disconnectTestDatabase(); });

  it("compte ce qui s'est passé sur la période, jour par jour", async () => {
    const { organization } = await createTestOrganization();
    await seed(organization.id);

    const stats = await getDashboardStats(organization.id, 7, NOW);

    expect(stats.from).toBe("2026-10-08");
    expect(stats.messages).toEqual({ fromClients: 3, byAssistant: 3, byTeam: 1, assistantShare: 75 });
    expect(stats.handoffs).toBe(1);
    expect(stats.orders).toEqual({ count: 2, revenue: 10000, paidRevenue: 7000, unpaid: 1 });
    expect(stats.appointments).toBe(1);
    expect(stats.conversations).toEqual({ started: 1, total: 1 });
    expect(stats.stages).toEqual({ NEW: 0, INTERESTED: 1, ORDERED: 0, CALLBACK: 0 });
    expect(stats.estimatedMinutesSaved).toBe(3);
    expect(stats.series).toHaveLength(7);
    expect(stats.series.find((entry) => entry.day === "2026-10-13")).toEqual({ day: "2026-10-13", clientMessages: 2, assistantMessages: 2, orders: 1 });
    expect(stats.series.find((entry) => entry.day === "2026-10-14")).toEqual({ day: "2026-10-14", clientMessages: 1, assistantMessages: 1, orders: 1 });
    expect(stats.series.find((entry) => entry.day === "2026-10-09")).toEqual({ day: "2026-10-09", clientMessages: 0, assistantMessages: 0, orders: 0 });
  });

  it("limite « aujourd'hui » au jour local en cours", async () => {
    const { organization } = await createTestOrganization();
    await seed(organization.id);
    const stats = await getDashboardStats(organization.id, 1, NOW);
    expect(stats.from).toBe("2026-10-14");
    expect(stats.messages.fromClients).toBe(1);
    expect(stats.orders.count).toBe(1);
    expect(stats.series).toHaveLength(1);
  });

  it("compte les messages reçus hors des horaires d'ouverture", async () => {
    const { organization } = await createTestOrganization();
    await seed(organization.id);
    await prisma.aiSettings.update({
      where: { organizationId: organization.id },
      data: { businessHoursEnabled: true, businessHours: { tue: [{ start: "08:00", end: "18:00" }], wed: [{ start: "08:00", end: "18:00" }] } },
    });
    const stats = await getDashboardStats(organization.id, 7, NOW);
    expect(stats.afterHours).toEqual({ enabled: true, clientMessages: 1 });
  });

  it("ne montre rien d'une autre entreprise", async () => {
    const { organization } = await createTestOrganization();
    const other = await createTestOrganization("Autre");
    await seed(other.organization.id);
    const stats = await getDashboardStats(organization.id, 30, NOW);
    expect(stats.messages.fromClients).toBe(0);
    expect(stats.orders.count).toBe(0);
    expect(stats.series.every((entry) => entry.clientMessages === 0)).toBe(true);
  });
});
