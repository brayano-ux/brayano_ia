import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ emails: [] as string[] }));
vi.mock("../notifications/email.service.js", () => ({
  isEmailConfigured: () => true,
  sendEmail: async (input: { subject: string }) => { hoisted.emails.push(input.subject); return true; },
}));

import { prisma } from "../database/client.js";
import { aiReply, createTestOrganization, disconnectTestDatabase, installScriptedAi, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { simulateAssistantReply } from "./tester.service.js";

// Lundi 12 octobre 2026, 08:00 UTC = 09:00 à Douala.
const NOW = new Date("2026-10-12T08:00:00Z");

async function expectNothingWritten() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(await prisma.conversation.count()).toBe(0);
  expect(await prisma.message.count()).toBe(0);
  expect(await prisma.order.count()).toBe(0);
  expect(await prisma.appointment.count()).toBe(0);
  expect(hoisted.emails).toEqual([]);
}

describe.skipIf(!integrationEnabled)("testeur de l'agent (base réelle)", () => {
  beforeEach(async () => {
    await resetDatabase();
    hoisted.emails.length = 0;
  });
  afterAll(async () => { await disconnectTestDatabase(); });

  it("répond avec le seul message d'accueil à une simple salutation", async () => {
    const { organization } = await createTestOrganization();
    await prisma.aiSettings.update({ where: { organizationId: organization.id }, data: { welcomeMessage: "Bienvenue chez Salon Éclat 👋" } });
    const calls = installScriptedAi([aiReply()]);
    const result = await simulateAssistantReply(organization.id, { message: "Bonjour", history: [] }, NOW);
    expect(result.replies).toEqual([{ type: "text", text: "Bienvenue chez Salon Éclat 👋" }]);
    expect(result.effects[0]?.type).toBe("welcome");
    expect(calls).toHaveLength(0);
    await expectNothingWritten();
  });

  it("montre le rendez-vous qui serait pris, avec les vrais créneaux, sans rien enregistrer", async () => {
    const { organization } = await createTestOrganization();
    await prisma.appointmentSettings.create({
      data: { organizationId: organization.id, enabled: true, slotMinutes: 30, minNoticeMinutes: 0, workingHours: { tue: [{ start: "08:00", end: "18:00" }] } },
    });
    installScriptedAi([
      aiReply({ reply: "C'est noté pour mardi à 10 h.", intent: "demande_disponibilite", booking: { action: "book", date: "2026-10-13", time: "10:00", service: "Coupe" } }),
      aiReply({ reply: "Je déplace à 11 h.", booking: { action: "reschedule", date: "2026-10-13", time: "11:00" } }),
      aiReply({ reply: "Annulé.", booking: { action: "cancel" } }),
    ]);

    const first = await simulateAssistantReply(organization.id, { message: "Je veux un rendez-vous mardi à 10h", history: [] }, NOW);
    expect(first.reply).toContain("Rendez-vous confirmé");
    expect(first.effects.find((effect) => effect.type === "booking")?.label).toContain("Rendez-vous qui serait réservé");
    expect(first.simulation.booking).not.toBeNull();
    expect(first.effects.find((effect) => effect.type === "stage")?.label).toContain("A commandé");

    const second = await simulateAssistantReply(organization.id, { message: "Plutôt 11h", history: [], simulation: first.simulation }, NOW);
    expect(second.effects.find((effect) => effect.type === "booking")?.label).toContain("déplacé");

    const third = await simulateAssistantReply(organization.id, { message: "Finalement j'annule", history: [], simulation: second.simulation }, NOW);
    expect(third.effects.find((effect) => effect.type === "booking")?.label).toContain("annulé");
    expect(third.simulation.booking).toBeNull();
    await expectNothingWritten();
  });

  it("explique pourquoi un créneau n'est pas enregistré", async () => {
    const { organization } = await createTestOrganization();
    await prisma.appointmentSettings.create({ data: { organizationId: organization.id, enabled: true, minNoticeMinutes: 0, workingHours: { tue: [{ start: "08:00", end: "12:00" }] } } });
    installScriptedAi([aiReply({ reply: "C'est noté pour mardi à 20 h.", booking: { action: "book", date: "2026-10-13", time: "20:00" } })]);
    const result = await simulateAssistantReply(organization.id, { message: "Mardi 20h", history: [] }, NOW);
    expect(result.effects.find((effect) => effect.type === "booking")?.label).toContain("créneau indisponible");
    expect(result.reply).toContain("pas disponible");
    await expectNothingWritten();
  });

  it("montre la commande qui serait enregistrée, puis son annulation, sans rien enregistrer", async () => {
    const { organization } = await createTestOrganization();
    const product = await prisma.product.create({ data: { organizationId: organization.id, name: "Soin hydratant", description: "Soin", price: "3 500 FCFA" } });
    await prisma.orderSettings.create({ data: { organizationId: organization.id, enabled: true } });
    installScriptedAi([
      aiReply({ reply: "Commande confirmée.", intent: "achat", order: { action: "create", items: [{ productId: product.id, quantity: 2 }], customerName: "Amina", address: "Bonamoussadi" } }),
      aiReply({ reply: "Commande annulée.", order: { action: "cancel" } }),
    ]);

    const created = await simulateAssistantReply(organization.id, { message: "Je confirme ma commande", history: [] }, NOW);
    expect(created.reply).toContain("Commande enregistrée");
    expect(created.effects.find((effect) => effect.type === "order")?.label).toContain("2 × Soin hydratant — 7 000 FCFA");
    expect(created.simulation.order).toEqual({ items: [{ quantity: 2, name: "Soin hydratant" }], total: 7000 });

    const cancelled = await simulateAssistantReply(organization.id, { message: "Finalement j'annule", history: [], simulation: created.simulation }, NOW);
    expect(cancelled.effects.find((effect) => effect.type === "order")?.label).toContain("annulée");
    expect(cancelled.simulation.order).toBeNull();
    await expectNothingWritten();
  });

  it("signale une commande à laquelle il manque l'adresse", async () => {
    const { organization } = await createTestOrganization();
    const product = await prisma.product.create({ data: { organizationId: organization.id, name: "Sac", description: "Sac", price: "5 000 FCFA" } });
    await prisma.orderSettings.create({ data: { organizationId: organization.id, enabled: true } });
    installScriptedAi([aiReply({ reply: "Commande confirmée.", order: { action: "create", items: [{ productId: product.id, quantity: 1 }], customerName: "Amina" } })]);
    const result = await simulateAssistantReply(organization.id, { message: "Je prends le sac", history: [] }, NOW);
    expect(result.effects.find((effect) => effect.type === "order")?.label).toContain("il manque une information");
    expect(result.reply).toContain("adresse de livraison");
  });

  it("montre les photos de produits qui seraient envoyées", async () => {
    const { organization } = await createTestOrganization();
    const make = (name: string) => prisma.product.create({ data: { organizationId: organization.id, name, description: name, price: "1 000 FCFA", imageUrl: `https://api.example.com/media/products/${organization.id}/${name}.jpg` } });
    const [robe, sac] = [await make("Robe"), await make("Sac")];
    installScriptedAi([aiReply({ reply: "Voici nos modèles.", productIds: [robe.id, sac.id] })]);
    const result = await simulateAssistantReply(organization.id, { message: "Envoyez-moi les photos", history: [] }, NOW);
    expect(result.replies.map((entry) => entry.type)).toEqual(["text", "image", "image"]);
    expect(result.effects.find((effect) => effect.type === "photo")?.label).toContain("Robe, Sac");
  });

  it("simule une photo reçue (preuve de paiement) sans prévenir personne, et corrige une confirmation de paiement", async () => {
    const { organization } = await createTestOrganization();
    const calls = installScriptedAi([
      aiReply({ reply: "Paiement confirmé, merci !", intent: "demande_paiement" }),
      aiReply({ reply: "J'ai bien reçu votre photo, l'équipe va vérifier le paiement." }),
    ]);
    const result = await simulateAssistantReply(organization.id, { message: "Voilà le paiement", history: [], media: { kind: "image", simulatedKind: "payment_proof", caption: "Voilà le paiement" } }, NOW);
    expect(calls[0]?.history.at(-1)?.content).toContain("[Fichier reçu : une photo qui ressemble à une preuve de paiement");
    expect(result.reply).toBe("J'ai bien reçu votre photo, l'équipe va vérifier le paiement.");
    expect(result.effects.find((effect) => effect.type === "file")?.label).toContain("preuve de paiement probable");
    await expectNothingWritten();
  });

  it("annonce le passage de main", async () => {
    const { organization } = await createTestOrganization();
    installScriptedAi([aiReply({ reply: "Je préviens l'équipe.", needsHuman: true, nextAction: "handoff", intent: "demande_contact_humain" })]);
    const result = await simulateAssistantReply(organization.id, { message: "Je veux parler à quelqu'un", history: [] }, NOW);
    expect(result.effects.find((effect) => effect.type === "handoff")?.label).toContain("l'IA se mettrait en pause");
    expect(result.effects.find((effect) => effect.type === "stage")?.label).toContain("À rappeler");
    await expectNothingWritten();
  });

  it("garde les champs historiques de la réponse", async () => {
    const { organization } = await createTestOrganization();
    installScriptedAi([aiReply({ reply: "Bonjour !", leadData: { name: "Amina" }, leadScore: 33 })]);
    const result = await simulateAssistantReply(organization.id, { message: "Bonjour, vous êtes où ?", history: [] }, NOW);
    expect(result).toMatchObject({ reply: "Bonjour !", qualificationStatus: "not_qualified", leadScore: 33, leadData: { name: "Amina" }, nextAction: "continue" });
  });
});
