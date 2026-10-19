import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { backfillConversationTracking } from "./backfill.js";

describe.skipIf(!integrationEnabled)("rattrapage des étiquettes (base réelle)", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await disconnectTestDatabase(); });

  it("rattrape les anciennes conversations sans toucher aux étiquettes fixées à la main", async () => {
    const { organization } = await createTestOrganization();
    const make = async (number: string, data: Record<string, unknown> = {}) => {
      const contact = await prisma.contact.create({ data: { organizationId: organization.id, whatsappJid: `${number}@s.whatsapp.net` } });
      return prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id, ...data } });
    };
    const withOrder = await make("1");
    const withAppointment = await make("2");
    const cancelledOnly = await make("3");
    const qualifying = await make("4", { qualificationStatus: "QUALIFYING" });
    const locked = await make("5", { stage: "CALLBACK", stageLocked: true });
    const lockedWithOrder = await make("6", { stage: "NEW", stageLocked: true });
    await prisma.order.create({ data: { organizationId: organization.id, conversationId: withOrder.id, customerName: "A", deliveryAddress: "x", items: [] } });
    await prisma.order.create({ data: { organizationId: organization.id, conversationId: lockedWithOrder.id, customerName: "A", deliveryAddress: "x", items: [] } });
    await prisma.order.create({ data: { organizationId: organization.id, conversationId: cancelledOnly.id, customerName: "A", deliveryAddress: "x", items: [], status: "CANCELLED" } });
    await prisma.appointment.create({ data: { organizationId: organization.id, conversationId: withAppointment.id, startsAt: new Date(), endsAt: new Date() } });
    await prisma.message.create({ data: { conversationId: withOrder.id, direction: "INBOUND", author: "CONTACT", type: "TEXT", content: "a", createdAt: new Date("2026-10-01T10:00:00Z") } });
    await prisma.message.create({ data: { conversationId: withOrder.id, direction: "INBOUND", author: "CONTACT", type: "TEXT", content: "b", createdAt: new Date("2026-10-02T10:00:00Z") } });
    await prisma.message.create({ data: { conversationId: withOrder.id, direction: "OUTBOUND", author: "AI", type: "TEXT", content: "c", createdAt: new Date("2026-10-03T10:00:00Z") } });

    await backfillConversationTracking();
    const stageOf = async (id: string) => (await prisma.conversation.findUniqueOrThrow({ where: { id } })).stage;

    expect(await stageOf(withOrder.id)).toBe("ORDERED");
    expect(await stageOf(withAppointment.id)).toBe("ORDERED");
    expect(await stageOf(cancelledOnly.id)).toBe("NEW");
    expect(await stageOf(qualifying.id)).toBe("INTERESTED");
    expect(await stageOf(locked.id)).toBe("CALLBACK");
    expect(await stageOf(lockedWithOrder.id)).toBe("NEW");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: withOrder.id } })).lastInboundAt).toEqual(new Date("2026-10-02T10:00:00Z"));
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: cancelledOnly.id } })).lastInboundAt).toBeNull();
  });

  it("peut être relancé sans rien changer", async () => {
    const { organization } = await createTestOrganization();
    await backfillConversationTracking();
    const second = await backfillConversationTracking();
    expect(second).toEqual({ lastInbound: 0, ordered: 0, interested: 0 });
  });
});
