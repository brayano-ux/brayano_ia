import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../notifications/email.service.js", () => ({ isEmailConfigured: () => false, sendEmail: async () => false }));

import { prisma } from "../database/client.js";
import { setAiOrchestratorForTests } from "../ai/ai.factory.js";
import type { AIChatMessage } from "../ai/ai.types.js";
import { setBillingEnforcedForTests } from "../billing/subscription.service.js";
import {
  aiReply, createTestOrganization, deliver, disconnectTestDatabase, FakeWhatsApp, inbound, installScriptedAi, integrationEnabled, resetDatabase,
} from "../test-support/integration.js";
import { processIncomingMessage } from "./incoming-message.js";
import { isLatestInbound, MESSAGE_GROUPING_WINDOW_MS, resetMessageGroupingForTests } from "./message-grouping.js";

const JID_NUMBER = "237655000009";

async function until(condition: () => Promise<boolean> | boolean, maxMs = 5_000) {
  const startedAt = Date.now();
  while (!(await condition())) {
    if (Date.now() - startedAt > maxMs) throw new Error("Condition jamais remplie.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const userTurns = (history: AIChatMessage[]) => history.filter((turn) => turn.role === "user").map((turn) => turn.content);
const credits = async (organizationId: string) => (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).freeAiResponsesRemaining;

describe.skipIf(!integrationEnabled)("messages envoyés à la suite (base réelle)", () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMessageGroupingForTests();
    setBillingEnforcedForTests(true);
  });
  afterAll(async () => {
    setBillingEnforcedForTests(null);
    await disconnectTestDatabase();
  });

  it("répond une seule fois à trois messages envoyés d'affilée, pour un seul message du forfait", async () => {
    const { organization } = await createTestOrganization();
    await prisma.organization.update({ where: { id: organization.id }, data: { freeAiResponsesRemaining: 50 } });
    const calls = installScriptedAi([aiReply({ reply: "Oui, nous avons des chaussures en 42, à 15 000 FCFA." })]);
    const whatsapp = new FakeWhatsApp();

    // Le silence attendu après chaque message ne se termine que lorsque le test le décide : les trois messages
    // arrivent donc « pendant » la fenêtre de regroupement.
    let endOfSilence!: () => void;
    const silence = new Promise<void>((resolve) => { endOfSilence = resolve; });
    const wait = async (ms: number) => { if (ms === MESSAGE_GROUPING_WINDOW_MS) await silence; };

    const pending: Array<Promise<void>> = [];
    const texts = ["Bonjour", "Vous avez des chaussures ?", "En 42"];
    for (const [index, text] of texts.entries()) {
      pending.push(processIncomingMessage({ organizationId: organization.id, instance: whatsapp, wait }, inbound(JID_NUMBER, text, { timestamp: new Date(Date.now() + index) })));
      await until(async () => (await prisma.message.count({ where: { direction: "INBOUND" } })) === index + 1);
    }
    endOfSilence();
    await Promise.all(pending);

    expect(calls).toHaveLength(1);
    expect(userTurns(calls[0]!.history)).toEqual(texts);
    expect(calls[0]!.systemPrompt).toContain("MESSAGES ENVOYÉS À LA SUITE");
    expect(calls[0]!.systemPrompt).toContain("3 messages d'affilée");
    expect(whatsapp.sent.map((item) => item.text)).toEqual(["Oui, nous avons des chaussures en 42, à 15 000 FCFA."]);
    expect(await credits(organization.id)).toBe(49);
    const reply = await prisma.message.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
    expect(reply.aiMeta).toMatchObject({ groupedMessages: 3 });
  });

  it("abandonne la réponse en préparation quand le client écrit de nouveau, puis répond à l'ensemble", async () => {
    const { organization } = await createTestOrganization();
    await prisma.organization.update({ where: { id: organization.id }, data: { freeAiResponsesRemaining: 50 } });
    await prisma.aiSettings.update({ where: { organizationId: organization.id }, data: { welcomeMessage: "Bienvenue chez Salon Éclat 👋" } });
    const whatsapp = new FakeWhatsApp();
    const context = { organizationId: organization.id, instance: whatsapp, wait: async () => {} };
    const second = inbound(JID_NUMBER, "Et vous livrez à Bonamoussadi ?");
    const calls: Array<{ systemPrompt: string; history: AIChatMessage[] }> = [];
    let secondDelivery: Promise<void> | null = null;

    setAiOrchestratorForTests({
      async getReply(conversationId: string, systemPrompt: string, history: AIChatMessage[]) {
        calls.push({ systemPrompt, history });
        if (calls.length === 1) {
          // Pendant que l'IA prépare la première réponse, le client envoie un second message.
          secondDelivery = processIncomingMessage(context, second);
          await until(() => isLatestInbound(conversationId, second.externalId));
          return aiReply({ reply: "La coupe coûte 5 000 FCFA." });
        }
        return aiReply({ reply: "La coupe coûte 5 000 FCFA et nous livrons à Bonamoussadi." });
      },
      async transcribeAudio() { return ""; },
    });

    await processIncomingMessage(context, inbound(JID_NUMBER, "Combien coûte la coupe ?", { timestamp: new Date(Date.now() - 1_000) }));
    await secondDelivery;

    expect(calls).toHaveLength(2);
    expect(userTurns(calls[1]!.history)).toEqual(["Combien coûte la coupe ?", "Et vous livrez à Bonamoussadi ?"]);
    // L'accueil est parti avant la réponse abandonnée : la seconde sait qu'il ne faut pas saluer à nouveau.
    expect(calls[1]!.systemPrompt).toContain("MESSAGE D'ACCUEIL DÉJÀ ENVOYÉ");
    expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bienvenue chez Salon Éclat 👋", "La coupe coûte 5 000 FCFA et nous livrons à Bonamoussadi."]);
    // La réponse abandonnée n'a rien coûté.
    expect(await credits(organization.id)).toBe(49);
  });

  it("répond normalement à deux messages espacés : deux réponses, la seconde connaît la première", async () => {
    const { organization } = await createTestOrganization();
    await prisma.organization.update({ where: { id: organization.id }, data: { freeAiResponsesRemaining: 50 } });
    const calls = installScriptedAi([aiReply({ reply: "Oui, nous livrons." }), aiReply({ reply: "Oui, aussi le dimanche." })]);
    const whatsapp = new FakeWhatsApp();

    await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous livrez ?", { timestamp: new Date(Date.now() - 2_000) }));
    await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Même le dimanche ?"));

    expect(whatsapp.sent.map((item) => item.text)).toEqual(["Oui, nous livrons.", "Oui, aussi le dimanche."]);
    expect(calls[1]!.history.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(calls[1]!.systemPrompt).not.toContain("MESSAGES ENVOYÉS À LA SUITE");
    expect(await credits(organization.id)).toBe(48);
  });
});

describe.skipIf(!integrationEnabled)("grand catalogue (base réelle)", () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMessageGroupingForTests();
  });

  async function orgWithLargeCatalog() {
    const { organization } = await createTestOrganization();
    const base = Date.now();
    // 44 articles récents sans rapport, puis l'article recherché, le plus ancien : hors des 30 derniers modifiés.
    await prisma.product.createMany({
      data: Array.from({ length: 44 }, (_value, index) => ({
        organizationId: organization.id, name: `Casserole inox ${index + 1}`, description: "Ustensile de cuisine", category: "Cuisine", price: "4 000 FCFA",
        updatedAt: new Date(base - index * 1_000),
      })),
    });
    const sandals = await prisma.product.create({
      data: {
        organizationId: organization.id, name: "Sandales cuir marron", description: "Sandales artisanales, semelle souple.", category: "Chaussures", price: "12 000 FCFA",
        imageUrl: "https://example.com/sandales.jpg", updatedAt: new Date(base - 3_600_000),
      },
    });
    return { organization, sandals };
  }

  it("donne à l'IA la fiche d'un article ancien que le client demande, et l'index du reste", async () => {
    const { organization, sandals } = await orgWithLargeCatalog();
    const calls = installScriptedAi((call) => aiReply({ reply: "Oui, voici nos sandales en cuir.", productId: call.systemPrompt.includes(sandals.id) ? sandals.id : "" }));
    const whatsapp = new FakeWhatsApp();

    await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Montrez-moi la photo de vos sandales en cuir"));

    const prompt = calls[0]!.systemPrompt;
    expect(prompt).toContain(sandals.id);
    expect(prompt).toContain("Sandales artisanales");
    expect(prompt).toContain("AUTRES ARTICLES DU CATALOGUE");
    expect(prompt).toContain("15 autres articles");
    // La fiche détaillée d'une casserole reléguée dans l'index n'est pas envoyée : seulement son nom et son prix.
    expect(prompt).toContain("Casserole inox 44 (4 000 FCFA)");
    expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text", "image"]);
    expect(whatsapp.sent[1]).toMatchObject({ imageUrl: "https://example.com/sandales.jpg" });

    const reply = await prisma.message.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
    expect(reply.aiMeta).toMatchObject({ discussedProductId: sandals.id, discussedProductName: "Sandales cuir marron" });
  });

  it("garde la fiche de l'article dont une photo vient d'être envoyée, même si le client ne le nomme plus", async () => {
    const { organization, sandals } = await orgWithLargeCatalog();
    const calls = installScriptedAi((call) => aiReply({ reply: "Oui.", productId: call.history.length === 1 ? sandals.id : "" }));
    const whatsapp = new FakeWhatsApp();

    await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Une photo des sandales en cuir svp", { timestamp: new Date(Date.now() - 60_000) }));
    await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Et vous livrez quand ?"));

    expect(calls).toHaveLength(2);
    expect(calls[1]!.systemPrompt).toContain(sandals.id);
  });
});
