import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { setAiOrchestratorForTests } from "../ai/ai.factory.js";
import { setBillingEnforcedForTests } from "../billing/subscription.service.js";
import { aiReply, createTestOrganization, disconnectTestDatabase, installScriptedAi, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { resetFollowUpFailuresForTests, runFollowUps } from "./follow-ups.js";

// Mercredi 14 octobre 2026, 10:00 UTC = 11:00 à Douala.
const NOW = new Date("2026-10-14T10:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600_000);

async function seed(organizationId: string, overrides: { stage?: "NEW" | "INTERESTED" | "ORDERED"; lastAuthor?: "AI" | "CONTACT"; hoursSince?: number; optedOut?: boolean; jid?: string } = {}) {
  const jid = overrides.jid ?? "237655000001@s.whatsapp.net";
  const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: jid, optedOut: overrides.optedOut ?? false } });
  const conversation = await prisma.conversation.create({ data: { organizationId, contactId: contact.id, stage: overrides.stage ?? "INTERESTED" } });
  const sinceMs = hoursAgo(overrides.hoursSince ?? 30);
  await prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", author: "CONTACT", type: "TEXT", content: "C'est combien la robe rouge ?", createdAt: new Date(sinceMs.getTime() - 60_000) } });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: overrides.lastAuthor === "CONTACT" ? "INBOUND" : "OUTBOUND",
      author: overrides.lastAuthor ?? "AI",
      type: "TEXT",
      content: overrides.lastAuthor === "CONTACT" ? "Je réfléchis" : "La robe rouge coûte 12 000 FCFA.",
      createdAt: sinceMs,
      aiMeta: { intent: "demande_prix", nextAction: "continue" },
    },
  });
  return { contact, conversation };
}

function makeDeps(overrides: Partial<{ connected: boolean }> = {}) {
  const sent: Array<{ organizationId: string; jid: string; text: string }> = [];
  return {
    sent,
    deps: {
      now: NOW,
      isConnected: () => overrides.connected ?? true,
      send: async (organizationId: string, jid: string, text: string) => { sent.push({ organizationId, jid, text }); },
      sleep: async () => {},
    },
  };
}

describe.skipIf(!integrationEnabled)("relances automatiques (base réelle)", () => {
  beforeEach(async () => {
    await resetDatabase();
    resetFollowUpFailuresForTests();
  });
  afterAll(async () => { setBillingEnforcedForTests(null); await disconnectTestDatabase(); });

  async function enable(organizationId: string, data: Record<string, unknown> = {}) {
    await prisma.aiSettings.update({ where: { organizationId }, data: { followUpEnabled: true, followUpDelayHours: 24, followUpMax: 1, ...data } });
  }

  it("relance un client intéressé qui n'a pas répondu, puis enregistre la relance", async () => {
    const { organization } = await createTestOrganization();
    await enable(organization.id);
    const { conversation } = await seed(organization.id);
    const calls = installScriptedAi([aiReply({ reply: "Bonjour ! Avez-vous eu le temps de réfléchir à la robe rouge ?" })]);
    const { deps, sent } = makeDeps();

    const result = await runFollowUps(deps);

    expect(result.sent).toBe(1);
    expect(sent).toEqual([{ organizationId: organization.id, jid: "237655000001@s.whatsapp.net", text: "Bonjour ! Avez-vous eu le temps de réfléchir à la robe rouge ?" }]);
    expect(calls[0]?.systemPrompt).toContain("RELANCE AUTOMATIQUE");
    const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(stored.followUpCount).toBe(1);
    expect(stored.lastFollowUpAt).toEqual(NOW);
    const last = await prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" } });
    expect(last.aiMeta).toMatchObject({ kind: "follow_up", number: 1 });
  });

  it("ne relance qu'une fois avec le maximum à 1", async () => {
    const { organization } = await createTestOrganization();
    await enable(organization.id);
    await seed(organization.id);
    installScriptedAi([aiReply({ reply: "Une relance." })]);
    const { deps, sent } = makeDeps();
    await runFollowUps(deps);
    await runFollowUps({ ...deps, now: new Date(NOW.getTime() + 3600_000) });
    expect(sent).toHaveLength(1);
  });

  it("ne relance rien quand la fonction est désactivée", async () => {
    const { organization } = await createTestOrganization();
    await seed(organization.id);
    installScriptedAi([aiReply()]);
    const { deps, sent } = makeDeps();
    expect((await runFollowUps(deps)).sent).toBe(0);
    expect(sent).toEqual([]);
  });

  it.each([
    ["un client qui a répondu", { lastAuthor: "CONTACT" as const }],
    ["un client qui a écrit STOP", { optedOut: true }],
    ["un client qui a déjà commandé", { stage: "ORDERED" as const }],
    ["un contact qui n'est pas encore intéressé", { stage: "NEW" as const }],
    ["un échange trop récent", { hoursSince: 5 }],
    ["un contact qui n'est pas un numéro WhatsApp personnel", { jid: "123456@lid" }],
  ])("ne relance pas %s", async (_label, override) => {
    const { organization } = await createTestOrganization();
    await enable(organization.id);
    await seed(organization.id, override);
    installScriptedAi([aiReply()]);
    const { deps, sent } = makeDeps();
    await runFollowUps(deps);
    expect(sent).toEqual([]);
  });

  it("n'écrit pas la nuit quand les horaires d'ouverture sont configurés", async () => {
    const { organization } = await createTestOrganization();
    await enable(organization.id, { businessHoursEnabled: true, businessHours: { wed: [{ start: "14:00", end: "18:00" }] } });
    await seed(organization.id);
    installScriptedAi([aiReply()]);
    const { deps, sent } = makeDeps();
    await runFollowUps(deps);
    expect(sent).toEqual([]);
    await runFollowUps({ ...deps, now: new Date("2026-10-14T14:00:00Z") }); // 15:00 locale, ouvert
    expect(sent).toHaveLength(1);
  });

  it("attend que WhatsApp soit connecté", async () => {
    const { organization } = await createTestOrganization();
    await enable(organization.id);
    await seed(organization.id);
    installScriptedAi([aiReply()]);
    const { deps, sent } = makeDeps({ connected: false });
    await runFollowUps(deps);
    expect(sent).toEqual([]);
  });

  it("n'insiste pas quand l'IA juge la relance déplacée (SKIP)", async () => {
    const { organization } = await createTestOrganization();
    await enable(organization.id);
    const { conversation } = await seed(organization.id);
    installScriptedAi([aiReply({ reply: "SKIP" })]);
    const { deps, sent } = makeDeps();
    await runFollowUps(deps);
    expect(sent).toEqual([]);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).followUpCount).toBe(1);
  });

  it("ne relance pas si le client écrit entre la préparation et l'envoi", async () => {
    const { organization } = await createTestOrganization();
    await enable(organization.id);
    const { conversation } = await seed(organization.id);
    setAiOrchestratorForTests({
      async getReply() {
        // Pendant que l'IA rédige la relance, le client répond.
        await prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", author: "CONTACT", type: "TEXT", content: "Oui je prends la robe", createdAt: new Date() } });
        return aiReply({ reply: "Une relance." });
      },
      async transcribeAudio() { return ""; },
    });
    const { deps, sent } = makeDeps();

    const result = await runFollowUps(deps);

    expect(sent).toEqual([]);
    expect(result.sent).toBe(0);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).followUpCount).toBe(0);
  });

  it("ne mélange pas les entreprises", async () => {
    const first = await createTestOrganization("Première");
    const second = await createTestOrganization("Seconde");
    await enable(first.organization.id);
    await seed(first.organization.id, { jid: "237655000001@s.whatsapp.net" });
    await seed(second.organization.id, { jid: "237655000002@s.whatsapp.net" });
    installScriptedAi([aiReply({ reply: "Relance." })]);
    const { deps, sent } = makeDeps();
    await runFollowUps(deps);
    expect(sent.map((entry) => entry.organizationId)).toEqual([first.organization.id]);
  });

  describe("forfaits", () => {
    beforeEach(() => setBillingEnforcedForTests(true));

    it("forfait Essentiel : pas de relance (fonction du Pro), et l'IA n'est même pas appelée", async () => {
      const { organization } = await createTestOrganization();
      await enable(organization.id);
      await prisma.billingSubscription.create({ data: { organizationId: organization.id, plan: "starter", messageLimit: 1000, expiresAt: new Date(NOW.getTime() + 20 * 24 * 3600_000), periodStartedAt: hoursAgo(48) } });
      await seed(organization.id);
      const calls = installScriptedAi([aiReply({ reply: "Relance" })]);
      const { deps, sent } = makeDeps();
      expect((await runFollowUps(deps)).sent).toBe(0);
      expect(calls).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it("forfait Pro : la relance part et compte comme un message de l'assistant", async () => {
      const { organization } = await createTestOrganization();
      await enable(organization.id);
      await prisma.billingSubscription.create({ data: { organizationId: organization.id, plan: "pro", messageLimit: 5000, expiresAt: new Date(Date.now() + 20 * 24 * 3600_000), periodStartedAt: new Date(Date.now() - 24 * 3600_000) } });
      await seed(organization.id);
      installScriptedAi([aiReply({ reply: "Toujours intéressé par la robe ?" })]);
      const { deps } = makeDeps();
      expect((await runFollowUps(deps)).sent).toBe(1);
      expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId: organization.id } })).messagesUsed).toBe(1);
    });

    it("quota atteint : pas de relance ; si l'IA répond SKIP ou plante, le message est rendu", async () => {
      const { organization } = await createTestOrganization();
      await enable(organization.id);
      await prisma.billingSubscription.create({ data: { organizationId: organization.id, plan: "pro", messageLimit: 1, messagesUsed: 1, expiresAt: new Date(Date.now() + 20 * 24 * 3600_000), periodStartedAt: new Date(Date.now() - 24 * 3600_000) } });
      await seed(organization.id);
      const calls = installScriptedAi([aiReply({ reply: "Relance" })]);
      const { deps } = makeDeps();
      expect((await runFollowUps(deps)).sent).toBe(0);
      expect(calls).toHaveLength(0);

      await prisma.billingSubscription.update({ where: { organizationId: organization.id }, data: { messageLimit: 5, messagesUsed: 0 } });
      installScriptedAi([aiReply({ reply: "SKIP" })]);
      expect((await runFollowUps(deps)).sent).toBe(0);
      expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId: organization.id } })).messagesUsed).toBe(0);
    });
  });
});
