import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { getConversationActivity } from "./conversations.service.js";

async function conversationFor(organizationId: string, number: string) {
  const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: `${number}@s.whatsapp.net` } });
  return prisma.conversation.create({ data: { organizationId, contactId: contact.id } });
}

describe.skipIf(!integrationEnabled)("fiche client : commandes et rendez-vous d'une conversation (base réelle)", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await disconnectTestDatabase(); });

  it("renvoie les commandes les plus récentes d'abord et ignore les rendez-vous annulés", async () => {
    const { organization } = await createTestOrganization();
    const conversation = await conversationFor(organization.id, "237655000041");
    const order = (customerName: string, createdAt: string, status: "NEW" | "CANCELLED" = "NEW") =>
      prisma.order.create({ data: { organizationId: organization.id, conversationId: conversation.id, customerName, deliveryAddress: "x", items: [], total: 1000, status, createdAt: new Date(createdAt) } });
    await order("Ancienne", "2026-10-01T10:00:00Z");
    await order("Récente", "2026-10-03T10:00:00Z", "CANCELLED");
    const appointment = (startsAt: string, status: "BOOKED" | "CANCELLED") =>
      prisma.appointment.create({ data: { organizationId: organization.id, conversationId: conversation.id, startsAt: new Date(startsAt), endsAt: new Date(new Date(startsAt).getTime() + 30 * 60_000), status } });
    await appointment("2026-10-05T09:00:00Z", "BOOKED");
    await appointment("2026-10-06T09:00:00Z", "CANCELLED");

    const activity = await getConversationActivity(organization.id, conversation.id);

    expect(activity.orders.map((entry) => entry.status)).toEqual(["CANCELLED", "NEW"]);
    expect(activity.appointments).toHaveLength(1);
    expect(activity.appointments[0]?.status).toBe("BOOKED");
  });

  it("ne renvoie rien pour une conversation d'une autre entreprise", async () => {
    const { organization } = await createTestOrganization();
    const other = await createTestOrganization("Autre");
    const foreign = await conversationFor(other.organization.id, "237655000042");
    await prisma.order.create({ data: { organizationId: other.organization.id, conversationId: foreign.id, customerName: "X", deliveryAddress: "x", items: [], total: 1000 } });

    const activity = await getConversationActivity(organization.id, foreign.id);

    expect(activity).toEqual({ orders: [], appointments: [] });
  });
});
