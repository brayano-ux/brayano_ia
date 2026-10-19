import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { createCorrection, createCorrectionFromMessage, deleteCorrection, listCorrections, updateCorrection } from "./corrections.service.js";

async function seedConversation(organizationId: string) {
  const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: "237655000001@s.whatsapp.net" } });
  const conversation = await prisma.conversation.create({ data: { organizationId, contactId: contact.id } });
  const [ask, answer] = await Promise.all([
    prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", author: "CONTACT", type: "TEXT", content: "Vous livrez à Bonamoussadi ?", createdAt: new Date("2026-10-01T10:00:00Z") } }),
    prisma.message.create({ data: { conversationId: conversation.id, direction: "OUTBOUND", author: "AI", type: "TEXT", content: "Non, nous ne livrons pas.", createdAt: new Date("2026-10-01T10:00:05Z") } }),
  ]);
  return { conversation, ask, answer };
}

describe.skipIf(!integrationEnabled)("corrections du propriétaire (base réelle)", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await disconnectTestDatabase(); });

  it("retient la question du client et la bonne réponse depuis une réponse de l'IA", async () => {
    const { organization } = await createTestOrganization();
    const { conversation, answer } = await seedConversation(organization.id);

    const correction = await createCorrectionFromMessage(organization.id, conversation.id, answer.id, { correctReply: "Oui, livraison à Bonamoussadi pour 1 000 FCFA." });

    expect(correction).toMatchObject({ question: "Vous livrez à Bonamoussadi ?", wrongReply: "Non, nous ne livrons pas.", correctReply: "Oui, livraison à Bonamoussadi pour 1 000 FCFA.", active: true });
  });

  it("peut créer une règle générale, sans question", async () => {
    const { organization } = await createTestOrganization();
    const { conversation, answer } = await seedConversation(organization.id);
    const correction = await createCorrectionFromMessage(organization.id, conversation.id, answer.id, { correctReply: "Toujours vouvoyer.", general: true });
    expect(correction.question).toBe("");
  });

  it("refuse de corriger la réponse d'une autre entreprise", async () => {
    const { organization } = await createTestOrganization();
    const other = await createTestOrganization("Autre");
    const { conversation, answer } = await seedConversation(organization.id);
    await expect(createCorrectionFromMessage(other.organization.id, conversation.id, answer.id, { correctReply: "x" })).rejects.toThrow("introuvable");
  });

  it("ne liste, ne modifie et ne supprime que les corrections de son entreprise", async () => {
    const { organization } = await createTestOrganization();
    const other = await createTestOrganization("Autre");
    const mine = await createCorrection(organization.id, { correctReply: "Ma règle" });
    const theirs = await createCorrection(other.organization.id, { correctReply: "Leur règle" });

    expect((await listCorrections(organization.id)).map((entry) => entry.id)).toEqual([mine.id]);
    await expect(updateCorrection(organization.id, theirs.id, { active: false })).rejects.toThrow("introuvable");
    await expect(deleteCorrection(organization.id, theirs.id)).rejects.toThrow("introuvable");

    expect((await updateCorrection(organization.id, mine.id, { active: false })).active).toBe(false);
    await deleteCorrection(organization.id, mine.id);
    expect(await listCorrections(organization.id)).toEqual([]);
  });

  it("limite le nombre de corrections actives", async () => {
    const { organization } = await createTestOrganization();
    await prisma.aiCorrection.createMany({ data: Array.from({ length: 200 }, (_, index) => ({ organizationId: organization.id, question: "", correctReply: `Règle ${index}` })) });
    await expect(createCorrection(organization.id, { correctReply: "Une de plus" })).rejects.toThrow("200 corrections actives");
  });
});
