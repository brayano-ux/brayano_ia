import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { listOrders, updateOrderPayment } from "./orders.service.js";

async function seedOrder(organizationId: string, overrides: { flagged?: boolean; status?: "NEW" | "CANCELLED" } = {}) {
  const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: `${Math.random().toString().slice(2, 14)}@s.whatsapp.net` } });
  const conversation = await prisma.conversation.create({ data: { organizationId, contactId: contact.id, paymentCheckPending: overrides.flagged ?? false } });
  const order = await prisma.order.create({
    data: { organizationId, conversationId: conversation.id, contactJid: contact.whatsappJid, customerName: "Amina", deliveryAddress: "Bonamoussadi", items: [], total: 7000, status: overrides.status ?? "NEW" },
  });
  return { conversation, order };
}

describe.skipIf(!integrationEnabled)("paiement des commandes (base réelle)", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await disconnectTestDatabase(); });

  it("commence « non payée » et signale une preuve de paiement reçue à vérifier", async () => {
    const { organization } = await createTestOrganization();
    const waiting = await seedOrder(organization.id, { flagged: true });
    const plain = await seedOrder(organization.id);

    const orders = await listOrders(organization.id);

    expect(orders.find((order) => order.id === waiting.order.id)).toMatchObject({ paymentStatus: "UNPAID", proofReceived: true });
    expect(orders.find((order) => order.id === plain.order.id)).toMatchObject({ paymentStatus: "UNPAID", proofReceived: false });
  });

  it("marque la commande payée, retient le moyen de paiement et efface le signalement", async () => {
    const { organization } = await createTestOrganization();
    const { order, conversation } = await seedOrder(organization.id, { flagged: true });

    const paid = await updateOrderPayment(organization.id, order.id, { paymentStatus: "PAID", paymentMethod: "Orange Money", paymentNote: "Réf. 123456" });

    expect(paid).toMatchObject({ paymentStatus: "PAID", paymentMethod: "Orange Money", paymentNote: "Réf. 123456" });
    expect(paid.paidAt).toBeInstanceOf(Date);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).paymentCheckPending).toBe(false);
    expect((await listOrders(organization.id, { payment: "PAID" })).map((entry) => entry.id)).toEqual([order.id]);
    expect(await listOrders(organization.id, { payment: "UNPAID" })).toEqual([]);
  });

  it("remet « non payée » en effaçant les détails du paiement", async () => {
    const { organization } = await createTestOrganization();
    const { order } = await seedOrder(organization.id);
    await updateOrderPayment(organization.id, order.id, { paymentStatus: "PAID", paymentMethod: "MTN MoMo" });
    const back = await updateOrderPayment(organization.id, order.id, { paymentStatus: "UNPAID" });
    expect(back).toMatchObject({ paymentStatus: "UNPAID", paymentMethod: null, paidAt: null });
  });

  it("garde le signalement tant qu'une autre commande du même client attend son paiement", async () => {
    const { organization } = await createTestOrganization();
    const first = await seedOrder(organization.id, { flagged: true });
    const second = await prisma.order.create({
      data: { organizationId: organization.id, conversationId: first.conversation.id, contactJid: first.order.contactJid, customerName: "Amina", deliveryAddress: "Akwa", items: [], total: 1000 },
    });
    await updateOrderPayment(organization.id, first.order.id, { paymentStatus: "PAID" });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: first.conversation.id } })).paymentCheckPending).toBe(true);
    await updateOrderPayment(organization.id, second.id, { paymentStatus: "PAID" });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: first.conversation.id } })).paymentCheckPending).toBe(false);
  });

  it("refuse de toucher à la commande d'une autre entreprise", async () => {
    const { organization } = await createTestOrganization();
    const other = await createTestOrganization("Autre");
    const { order } = await seedOrder(other.organization.id);
    await expect(updateOrderPayment(organization.id, order.id, { paymentStatus: "PAID" })).rejects.toThrow("introuvable");
  });

  it("ne signale pas une commande annulée", async () => {
    const { organization } = await createTestOrganization();
    await seedOrder(organization.id, { flagged: true, status: "CANCELLED" });
    expect((await listOrders(organization.id))[0]?.proofReceived).toBe(false);
  });
});
