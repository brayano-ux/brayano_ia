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
  describe("ce que l'assistant rapporte", () => {
    const at = (time: string) => new Date(`2026-10-13T${time}Z`);

    async function conversationWith(organizationId: string, number: string, displayName: string | null = null) {
      const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: `${number}@s.whatsapp.net`, displayName } });
      const conversation = await prisma.conversation.create({ data: { organizationId, contactId: contact.id, createdAt: at("08:00:00") } });
      const message = (direction: "INBOUND" | "OUTBOUND", time: string, content: string, aiMeta?: object) =>
        prisma.message.create({ data: { conversationId: conversation.id, direction, author: direction === "INBOUND" ? "CONTACT" : "AI", type: "TEXT", content, createdAt: at(time), ...(aiMeta ? { aiMeta } : {}) } });
      return { conversation, message };
    }

    it("calcule le taux de conversion des conversations en commandes ou rendez-vous", async () => {
      const { organization } = await createTestOrganization();
      const buyer = await conversationWith(organization.id, "237655000011");
      const booker = await conversationWith(organization.id, "237655000012");
      const browser = await conversationWith(organization.id, "237655000013");
      const cancelled = await conversationWith(organization.id, "237655000014");
      for (const entry of [buyer, booker, browser, cancelled]) await entry.message("INBOUND", "09:00:00", "Bonjour");
      await prisma.order.create({ data: { organizationId: organization.id, conversationId: buyer.conversation.id, customerName: "A", deliveryAddress: "x", items: [], total: 5000, createdAt: at("10:00:00") } });
      // Deux commandes du même client : une seule conversation convertie.
      await prisma.order.create({ data: { organizationId: organization.id, conversationId: buyer.conversation.id, customerName: "A", deliveryAddress: "x", items: [], total: 2000, createdAt: at("11:00:00") } });
      await prisma.appointment.create({ data: { organizationId: organization.id, conversationId: booker.conversation.id, startsAt: new Date("2026-10-20T09:00:00Z"), endsAt: new Date("2026-10-20T09:30:00Z"), createdAt: at("10:00:00") } });
      await prisma.order.create({ data: { organizationId: organization.id, conversationId: cancelled.conversation.id, customerName: "D", deliveryAddress: "x", items: [], total: 1000, status: "CANCELLED", createdAt: at("10:00:00") } });

      const stats = await getDashboardStats(organization.id, 7, NOW);

      expect(stats.conversion).toEqual({ activeConversations: 4, converted: 2, rate: 50 });
    });

    it("renvoie un taux nul sans conversation sur la période", async () => {
      const { organization } = await createTestOrganization();
      const stats = await getDashboardStats(organization.id, 7, NOW);
      expect(stats.conversion).toEqual({ activeConversations: 0, converted: 0, rate: null });
      expect(stats.topProducts).toEqual([]);
      expect(stats.unanswered).toEqual({ count: 0, items: [] });
    });

    it("classe les articles par nombre de clients intéressés, avec photos envoyées et quantités commandées", async () => {
      const { organization } = await createTestOrganization();
      const other = await createTestOrganization("Autre boutique");
      const product = (organizationId: string, name: string) => prisma.product.create({ data: { organizationId, name, description: "x" } });
      const robe = await product(organization.id, "Robe wax");
      const sac = await product(organization.id, "Sac en cuir");
      const foreign = await product(other.organization.id, "Produit d'une autre entreprise");

      const first = await conversationWith(organization.id, "237655000021");
      const second = await conversationWith(organization.id, "237655000022");
      const elsewhere = await conversationWith(other.organization.id, "237655000023");
      await first.message("OUTBOUND", "09:00:05", "Voici la robe", { discussedProductId: robe.id, discussedProductName: "Robe wax" });
      await first.message("OUTBOUND", "09:05:05", "Elle est en coton", { discussedProductId: robe.id, discussedProductName: "Robe wax" });
      await second.message("OUTBOUND", "09:00:05", "Le sac est à 20 000", { discussedProductId: sac.id, discussedProductName: "Sac en cuir" });
      await elsewhere.message("OUTBOUND", "09:00:05", "x", { discussedProductId: foreign.id, discussedProductName: "Produit d'une autre entreprise" });
      await prisma.sentProductImage.create({ data: { whatsappMessageId: "IMG-1", conversationId: second.conversation.id, productId: robe.id, createdAt: at("09:10:00") } });
      await prisma.sentProductImage.create({ data: { whatsappMessageId: "IMG-OLD", conversationId: second.conversation.id, productId: sac.id, createdAt: new Date("2026-09-01T09:00:00Z") } });
      await prisma.order.create({
        data: { organizationId: organization.id, conversationId: first.conversation.id, customerName: "A", deliveryAddress: "x", total: 50000, createdAt: at("10:00:00"), items: [{ productId: robe.id, name: "Robe wax", quantity: 2 }] },
      });

      const stats = await getDashboardStats(organization.id, 7, NOW);

      expect(stats.topProducts).toEqual([
        { productId: robe.id, name: "Robe wax", interested: 2, photos: 1, ordered: 2 },
        { productId: sac.id, name: "Sac en cuir", interested: 1, photos: 0, ordered: 0 },
      ]);
    });

    it("liste les questions restées sans réponse, avec la question du client, de la plus récente à la plus ancienne", async () => {
      const { organization } = await createTestOrganization();
      const named = await conversationWith(organization.id, "237655000031", "Aïcha");
      const anonymous = await conversationWith(organization.id, "237655000032");
      await named.message("INBOUND", "09:00:00", "Vous livrez à Bafoussam en combien de temps ?");
      await named.message("OUTBOUND", "09:00:05", "Je me renseigne.", { missingInfo: "délai de livraison à Bafoussam" });
      await named.message("INBOUND", "09:10:00", "Merci");
      await named.message("OUTBOUND", "09:10:05", "Avec plaisir.", { missingInfo: "" });
      await anonymous.message("INBOUND", "11:00:00", "La robe existe en taille 46 ?");
      await anonymous.message("OUTBOUND", "11:00:05", "Je vérifie.", { missingInfo: "tailles disponibles pour la robe" });

      const stats = await getDashboardStats(organization.id, 7, NOW);

      expect(stats.unanswered.count).toBe(2);
      expect(stats.unanswered.items.map((item) => [item.contact, item.missing, item.question])).toEqual([
        ["+237655000032", "tailles disponibles pour la robe", "La robe existe en taille 46 ?"],
        ["Aïcha", "délai de livraison à Bafoussam", "Vous livrez à Bafoussam en combien de temps ?"],
      ]);
      expect(stats.unanswered.items[0]).toMatchObject({ conversationId: anonymous.conversation.id, at: "2026-10-13T11:00:05.000Z" });
    });
  });
});
