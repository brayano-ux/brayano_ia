import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  process.env.CLIENT_MEDIA_DIR = `/tmp/brayano-test-media-${process.pid}`;
  return { sentEmails: [] as Array<{ to: string; subject: string; text: string }> };
});
vi.mock("../notifications/email.service.js", () => ({
  isEmailConfigured: () => true,
  sendEmail: async (input: { to: string; subject: string; text: string }) => { hoisted.sentEmails.push(input); return true; },
}));

import { rmSync } from "node:fs";
import { prisma } from "../database/client.js";
import { recordInboundMessage } from "../conversations/conversations.service.js";
import { processIncomingMessage } from "./incoming-message.js";
import { setAiOrchestratorForTests } from "../ai/ai.factory.js";
import { setBillingEnforcedForTests } from "../billing/subscription.service.js";
import type { MediaAnalysis } from "../ai/media-analysis.js";
import {
  aiReply, createTestOrganization, deliver, disconnectTestDatabase, FakeWhatsApp, inbound, installScriptedAi, integrationEnabled, resetDatabase,
} from "../test-support/integration.js";

const JID_NUMBER = "237655000001";
const JID = `${JID_NUMBER}@s.whatsapp.net`;

async function flushEmails() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe.skipIf(!integrationEnabled)("traitement d'un message entrant (base réelle)", () => {
  beforeEach(async () => {
    await resetDatabase();
    hoisted.sentEmails.length = 0;
  });
  afterAll(async () => {
    await disconnectTestDatabase();
    rmSync(process.env.CLIENT_MEDIA_DIR!, { recursive: true, force: true });
  });

  it("enregistre le message du client, répond via WhatsApp et enregistre la réponse avec son journal", async () => {
    const { organization } = await createTestOrganization();
    installScriptedAi([aiReply({ reply: "Oui, nous ouvrons le samedi.", intent: "demande_information" })]);
    const whatsapp = new FakeWhatsApp();

    await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous ouvrez le samedi ?"));

    expect(whatsapp.sent.map((item) => item.text)).toEqual(["Oui, nous ouvrons le samedi."]);
    const messages = await prisma.message.findMany({ orderBy: { createdAt: "asc" } });
    expect(messages.map((item) => [item.direction, item.author, item.content])).toEqual([
      ["INBOUND", "CONTACT", "Vous ouvrez le samedi ?"],
      ["OUTBOUND", "AI", "Oui, nous ouvrons le samedi."],
    ]);
    expect(messages[1]?.aiMeta).toMatchObject({ intent: "demande_information", actions: [], welcomeSent: false });
  });

  it("ne perd pas la réponse quand un second message arrive pendant l'attente avant l'envoi", async () => {
    const { organization } = await createTestOrganization();
    installScriptedAi([aiReply({ reply: "Réponse à la première question." })]);
    const whatsapp = new FakeWhatsApp();

    await processIncomingMessage(
      {
        organizationId: organization.id,
        instance: whatsapp,
        // Pendant le délai avant réponse, un second message du client est enregistré (l'IA est déjà en route).
        wait: async () => { await recordInboundMessage({ organizationId: organization.id, fromJid: `${JID_NUMBER}@s.whatsapp.net`, externalId: "SECOND-1", text: "Seconde question", timestamp: new Date() }); },
      },
      inbound(JID_NUMBER, "Première question"),
    );

    expect(whatsapp.sent.map((item) => item.text)).toEqual(["Réponse à la première question."]);
  });

  describe("message d'accueil", () => {
    it("répond seulement par l'accueil à une simple salutation, sans appeler l'IA", async () => {
      const { organization } = await createTestOrganization();
      await prisma.aiSettings.update({ where: { organizationId: organization.id }, data: { welcomeMessage: "Bienvenue chez Salon Éclat 👋" } });
      const calls = installScriptedAi([aiReply()]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Bonjour"));

      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bienvenue chez Salon Éclat 👋"]);
      expect(calls).toHaveLength(0);
    });

    it("envoie l'accueil puis la réponse à une vraie question, et ne le renvoie pas ensuite", async () => {
      const { organization } = await createTestOrganization();
      await prisma.aiSettings.update({ where: { organizationId: organization.id }, data: { welcomeMessage: "Bienvenue chez Salon Éclat 👋" } });
      const calls = installScriptedAi([aiReply({ reply: "La coupe coûte 5 000 FCFA." }), aiReply({ reply: "Oui, samedi." })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Combien coûte la coupe ?"));
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous ouvrez samedi ?"));

      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bienvenue chez Salon Éclat 👋", "La coupe coûte 5 000 FCFA.", "Oui, samedi."]);
      expect(calls[0]?.systemPrompt).toContain("MESSAGE D'ACCUEIL DÉJÀ ENVOYÉ");
      expect(calls[1]?.systemPrompt).not.toContain("MESSAGE D'ACCUEIL DÉJÀ ENVOYÉ");
      // Le dernier tour vu par l'IA est bien la question du client (l'accueil est placé devant).
      expect(calls[0]?.history).toEqual([{ role: "assistant", content: "Bienvenue chez Salon Éclat 👋" }, { role: "user", content: "Combien coûte la coupe ?" }]);
    });

    it("n'envoie rien de plus quand aucun accueil n'est configuré", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply({ reply: "Bonjour !" })]);
      const whatsapp = new FakeWhatsApp();
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Bonjour"));
      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bonjour !"]);
    });
  });

  describe("prise de relais par un humain", () => {
    it("prévient le propriétaire par email avec la raison et les derniers messages", async () => {
      const { organization, user } = await createTestOrganization();
      installScriptedAi([aiReply({ reply: "Je préviens l'équipe.", needsHuman: true, nextAction: "handoff", intent: "demande_contact_humain", leadData: { name: "Amina" } })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Je veux parler à la gérante"));
      await flushEmails();

      expect(hoisted.sentEmails).toHaveLength(1);
      expect(hoisted.sentEmails[0]?.to).toBe(user.email);
      expect(hoisted.sentEmails[0]?.subject).toContain("Amina");
      expect(hoisted.sentEmails[0]?.text).toContain("parler à une personne");
      expect(hoisted.sentEmails[0]?.text).toContain("Je veux parler à la gérante");
      const conversation = await prisma.conversation.findFirstOrThrow();
      expect(conversation.status).toBe("HUMAN_HANDOFF");
      expect(conversation.stage).toBe("CALLBACK");
    });

    it("n'envoie pas d'email quand l'IA répond normalement", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply()]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Bonjour, vous êtes où ?"));
      await flushEmails();
      expect(hoisted.sentEmails).toHaveLength(0);
    });
  });

  describe("photos de produits envoyées au client", () => {
    async function seedProducts(organizationId: string) {
      const make = (name: string, withImage: boolean) =>
        prisma.product.create({ data: { organizationId, name, description: `${name} description`, price: "10 000 FCFA", imageUrl: withImage ? `https://api.example.com/media/products/${organizationId}/${name}.jpg` : null } });
      return {
        robe: await make("Robe", true),
        sac: await make("Sac", true),
        sans: await make("Foulard", false),
        chapeau: await make("Chapeau", true),
        ceinture: await make("Ceinture", true),
        pantalon: await make("Pantalon", true),
        veste: await make("Veste", true),
      };
    }

    it("envoie la photo d'un produit demandé, avec son nom et son prix", async () => {
      const { organization } = await createTestOrganization();
      const { robe } = await seedProducts(organization.id);
      installScriptedAi([aiReply({ reply: "Voici la robe.", productId: robe.id })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous avez la photo de la robe ?"));

      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text", "image"]);
      expect(whatsapp.sent[0]?.text).toContain("Produit : Robe");
      expect(whatsapp.sent[1]).toMatchObject({ imageUrl: expect.stringContaining("/Robe.jpg"), text: "Robe · 10 000 FCFA" });
    });

    it("envoie jusqu'à 5 photos quand le client en demande plusieurs", async () => {
      const { organization } = await createTestOrganization();
      const { robe, sac, sans, chapeau, ceinture, pantalon, veste } = await seedProducts(organization.id);
      installScriptedAi([aiReply({ reply: "Voici nos modèles.", productIds: [robe.id, sans.id, sac.id, chapeau.id, ceinture.id, pantalon.id, veste.id] })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Montrez-moi toutes les photos de vos articles"));

      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text", "image", "image", "image", "image", "image"]);
      expect(whatsapp.sent.slice(1).map((item) => item.text)).toEqual([
        "Robe · 10 000 FCFA",
        "Sac · 10 000 FCFA",
        "Chapeau · 10 000 FCFA",
        "Ceinture · 10 000 FCFA",
        "Pantalon · 10 000 FCFA",
      ]);
    });

    it("quand la photo ne part pas, le client reçoit quand même le texte et une explication honnête", async () => {
      const { organization } = await createTestOrganization();
      const { robe } = await seedProducts(organization.id);
      installScriptedAi([aiReply({ reply: "Voici la robe.", productId: robe.id })]);
      const whatsapp = new FakeWhatsApp();
      whatsapp.failImages = 1;

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous avez la photo de la robe ?"));

      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text", "text"]);
      expect(whatsapp.sent[0]?.text).toContain("Voici la robe.");
      expect(whatsapp.sent[1]?.text).toMatch(/n'arrive pas à envoyer la photo \(Robe\)/);
      const reply = await prisma.message.findFirst({ where: { direction: "OUTBOUND" }, orderBy: { createdAt: "desc" } });
      expect(reply?.aiMeta).toMatchObject({ photosSent: 0, imagesFailed: 1 });
    });

    it("avec plusieurs photos, seules celles qui échouent sont signalées", async () => {
      const { organization } = await createTestOrganization();
      const { robe, sac } = await seedProducts(organization.id);
      installScriptedAi([aiReply({ reply: "Voici nos modèles.", productIds: [robe.id, sac.id] })]);
      const whatsapp = new FakeWhatsApp();
      whatsapp.failImages = 1;

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Montrez-moi la robe et le sac en photo"));

      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text", "image", "text"]);
      expect(whatsapp.sent[1]?.text).toBe("Sac · 10 000 FCFA");
      expect(whatsapp.sent[2]?.text).toMatch(/la photo \(Robe\)/);
    });

    it("n'envoie pas de photo quand le client n'en a pas demandé, même si le modèle en propose une", async () => {
      const { organization } = await createTestOrganization();
      const { robe } = await seedProducts(organization.id);
      installScriptedAi([aiReply({ reply: "La robe coûte 10 000 FCFA.", productId: robe.id })]);
      const whatsapp = new FakeWhatsApp();
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Combien coûte la robe ?"));
      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text"]);
    });

    it("ne prend pas une photo reçue du client pour une demande de photo", async () => {
      const { organization } = await createTestOrganization();
      const { robe } = await seedProducts(organization.id);
      installScriptedAi([aiReply({ reply: "J'ai bien reçu votre photo.", productId: robe.id })]);
      const whatsapp = new FakeWhatsApp();
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "[Photo reçue]", { media: { kind: "image", mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff, 1]) } }));
      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text"]);
    });
  });

  describe("STOP", () => {
    it("n'envoie plus de relances ni de messages groupés au client qui écrit STOP, et le confirme sans appeler l'IA", async () => {
      const { organization } = await createTestOrganization();
      const calls = installScriptedAi([aiReply()]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "STOP"));

      expect(calls).toHaveLength(0);
      expect(whatsapp.sent[0]?.text).toContain("Bien noté");
      expect((await prisma.contact.findFirstOrThrow()).optedOut).toBe(true);
    });

    it("ne prend pas pour un désabonnement un message qui contient une vraie demande", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply({ reply: "Voici la robe." })]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Stop, montrez-moi plutôt la robe rouge s'il vous plaît, merci beaucoup"));
      expect((await prisma.contact.findFirstOrThrow()).optedOut).toBe(false);
    });
  });

  describe("photos et documents reçus", () => {
    const photo = (caption?: string) => ({
      text: caption ?? "[Photo reçue]",
      media: { kind: "image" as const, mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), ...(caption ? { caption } : {}) },
    });

    it("range la photo, prévient le propriétaire d'une preuve de paiement et le signale dans la conversation", async () => {
      const { organization } = await createTestOrganization();
      const analysis: MediaAnalysis = { kind: "payment_proof", summary: "Transfert Orange Money de 15 000 FCFA" };
      const calls: string[] = [];
      setAiOrchestratorForTests({
        async getReply(_id: string, _prompt: string, history: Array<{ content: string }>) {
          calls.push(history.map((entry) => entry.content).join("\n"));
          return aiReply({ reply: "J'ai bien reçu votre photo. L'équipe va vérifier votre paiement.", intent: "demande_paiement" });
        },
        async transcribeAudio() { return ""; },
        async analyzeMedia() { return analysis; },
      });
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Voilà le paiement", photo("Voilà le paiement")));
      await flushEmails();

      const stored = await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } });
      expect(stored.type).toBe("IMAGE");
      expect(stored.mediaFile).toMatch(/\.jpg$/);
      expect(stored.mediaMimeType).toBe("image/jpeg");
      expect(stored.aiMeta).toMatchObject({ mediaKind: "payment_proof", mediaSummary: "Transfert Orange Money de 15 000 FCFA" });
      expect((await prisma.conversation.findFirstOrThrow()).paymentCheckPending).toBe(true);
      expect(hoisted.sentEmails.map((email) => email.subject).join("|")).toContain("Preuve de paiement reçue");
      expect(hoisted.sentEmails.find((email) => email.subject.includes("Preuve"))?.text).toContain("15 000 FCFA");
      expect(calls[0]).toContain("[Fichier reçu : une photo qui ressemble à une preuve de paiement — analyse automatique : Transfert Orange Money de 15 000 FCFA");
      expect(whatsapp.sent[0]?.text).toContain("J'ai bien reçu votre photo");
    });

    it("corrige une réponse qui confirme un paiement à la place du propriétaire", async () => {
      const { organization } = await createTestOrganization();
      const calls = installScriptedAi([
        aiReply({ reply: "Votre paiement a bien été reçu, merci !", intent: "demande_paiement" }),
        aiReply({ reply: "J'ai bien reçu votre photo, l'équipe va vérifier le paiement.", intent: "demande_paiement" }),
      ]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Voilà le paiement", photo("Voilà le paiement")));

      expect(calls).toHaveLength(2);
      expect(calls[1]?.systemPrompt).toContain("JAMAIS confirmer un paiement");
      expect(whatsapp.sent.map((item) => item.text)).toEqual(["J'ai bien reçu votre photo, l'équipe va vérifier le paiement."]);
    });

    it("ne prévient pas dix fois pour dix photos du même client, mais toujours pour un paiement", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply({ reply: "Bien reçu." })]);
      const whatsapp = new FakeWhatsApp();

      for (let index = 0; index < 3; index += 1) await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "[Photo reçue]", photo()));
      await flushEmails();
      expect(hoisted.sentEmails.filter((email) => email.subject.includes("Photo reçue"))).toHaveLength(1);

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Voici le reçu momo", photo("Voici le reçu momo")));
      await flushEmails();
      expect(hoisted.sentEmails.filter((email) => email.subject.includes("Preuve de paiement"))).toHaveLength(1);
    });

    it("garde une trace même quand le fichier n'a pas pu être téléchargé", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply({ reply: "Merci, je regarde." })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "[Photo reçue]", { media: { kind: "image", mimeType: "image/jpeg" } }));

      const stored = await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } });
      expect(stored.type).toBe("IMAGE");
      expect(stored.mediaFile).toBeNull();
      expect(stored.aiMeta).toMatchObject({ mediaStored: false });
      expect(whatsapp.sent).toHaveLength(1);
    });
  });

  describe("contacts à ignorer", () => {
    it("ne répond jamais, ne prévient pas le propriétaire, mais garde le message dans la conversation", async () => {
      const { organization } = await createTestOrganization();
      await prisma.ignoredContact.create({ data: { organizationId: organization.id, whatsappNumber: JID_NUMBER, label: "Maman" } });
      const calls = installScriptedAi([aiReply()]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Coucou, tu es là ?"));
      await flushEmails();

      expect(calls).toHaveLength(0);
      expect(whatsapp.sent).toHaveLength(0);
      expect(hoisted.sentEmails).toHaveLength(0);
      const stored = await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } });
      expect(stored.content).toBe("Coucou, tu es là ?");
    });

    it("recommence à répondre normalement une fois le numéro retiré de la liste", async () => {
      const { organization } = await createTestOrganization();
      const ignored = await prisma.ignoredContact.create({ data: { organizationId: organization.id, whatsappNumber: JID_NUMBER } });
      installScriptedAi([aiReply({ reply: "Ne devrait pas partir." })]);
      const whatsapp = new FakeWhatsApp();
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Message ignoré"));
      expect(whatsapp.sent).toHaveLength(0);

      await prisma.ignoredContact.delete({ where: { id: ignored.id } });
      installScriptedAi([aiReply({ reply: "Oui, bonjour !" })]);
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous êtes là ?"));

      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Oui, bonjour !"]);
    });

    it("n'affecte pas les autres contacts de la même entreprise", async () => {
      const { organization } = await createTestOrganization();
      await prisma.ignoredContact.create({ data: { organizationId: organization.id, whatsappNumber: JID_NUMBER } });
      installScriptedAi([aiReply({ reply: "Bonjour, ravi de vous aider." })]);
      const whatsapp = new FakeWhatsApp();
      const OTHER_NUMBER = "237655000099";

      await deliver(organization.id, whatsapp, inbound(OTHER_NUMBER, "Bonjour"));

      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bonjour, ravi de vous aider."]);
    });
  });

  describe("sujet autorisé", () => {
    async function orgWithTopicGate(topic = "nos vêtements") {
      const { organization } = await createTestOrganization();
      await prisma.aiSettings.update({ where: { organizationId: organization.id }, data: { topicGateEnabled: true, topicGateTopic: topic } });
      return organization;
    }

    it("ne répond pas à un message hors sujet, mais garde le message dans la conversation", async () => {
      const organization = await orgWithTopicGate();
      installScriptedAi([aiReply({ reply: "Nous ouvrons à 8h.", onTopic: false })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous êtes ouverts demain ?"));

      expect(whatsapp.sent).toHaveLength(0);
      expect((await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } })).content).toBe("Vous êtes ouverts demain ?");
      expect((await prisma.conversation.findFirstOrThrow()).topicGateOpened).toBe(false);
    });

    it("répond dès que le message correspond au sujet, et ouvre la porte pour la suite", async () => {
      const organization = await orgWithTopicGate();
      installScriptedAi([
        aiReply({ reply: "Oui, la robe rouge est disponible à 12 000 FCFA.", onTopic: true }),
        aiReply({ reply: "Elle est en taille M et L." }),
      ]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Je voudrais en savoir plus sur ces vêtements"));
      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Oui, la robe rouge est disponible à 12 000 FCFA."]);
      expect((await prisma.conversation.findFirstOrThrow()).topicGateOpened).toBe(true);

      // La porte reste ouverte : la suite de la conversation reçoit une réponse normale, même sans re-classification.
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Et en quelle taille ?"));
      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Oui, la robe rouge est disponible à 12 000 FCFA.", "Elle est en taille M et L."]);
    });

    it("ne consomme pas de message du forfait pour un message bloqué", async () => {
      const organization = await orgWithTopicGate();
      await prisma.organization.update({ where: { id: organization.id }, data: { freeAiResponsesRemaining: 3 } });
      setBillingEnforcedForTests(true);
      try {
        installScriptedAi([aiReply({ onTopic: false })]);
        await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Bonjour, vous vendez des meubles ?"));
        expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).freeAiResponsesRemaining).toBe(3);
      } finally {
        setBillingEnforcedForTests(null);
      }
    });

    it("n'a aucun effet quand il n'est pas activé", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply({ reply: "Bonjour, comment puis-je vous aider ?" })]);
      const whatsapp = new FakeWhatsApp();
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous êtes ouverts demain ?"));
      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bonjour, comment puis-je vous aider ?"]);
    });
  });

  describe("publicité Facebook/Instagram uniquement", () => {
    async function orgWithAdOnly() {
      const { organization } = await createTestOrganization();
      await prisma.aiSettings.update({ where: { organizationId: organization.id }, data: { adOnlyEnabled: true } });
      return organization;
    }

    it("ne répond pas à un client qui n'est pas venu d'une publicité, mais garde le message", async () => {
      const organization = await orgWithAdOnly();
      const calls = installScriptedAi([aiReply()]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Bonjour, vous êtes ouverts ?"));

      expect(calls).toHaveLength(0);
      expect(whatsapp.sent).toHaveLength(0);
      expect((await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } })).content).toBe("Bonjour, vous êtes ouverts ?");
      expect((await prisma.conversation.findFirstOrThrow()).startedFromAd).toBe(false);
    });

    it("répond à un client venu d'une publicité, et continue de lui répondre ensuite", async () => {
      const organization = await orgWithAdOnly();
      installScriptedAi([
        aiReply({ reply: "Bonjour ! La robe rouge est à 12 000 FCFA." }),
        aiReply({ reply: "Elle est disponible en taille M." }),
      ]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Bonjour, je viens de votre publicité", { startedFromAd: true }));
      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bonjour ! La robe rouge est à 12 000 FCFA."]);
      expect((await prisma.conversation.findFirstOrThrow()).startedFromAd).toBe(true);

      // Le deuxième message n'a plus la marque « publicité » (comme sur WhatsApp), mais la conversation reste ouverte.
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Et en quelle taille ?"));
      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bonjour ! La robe rouge est à 12 000 FCFA.", "Elle est disponible en taille M."]);
    });

    it("n'a aucun effet quand il n'est pas activé", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply({ reply: "Bonjour, comment puis-je vous aider ?" })]);
      const whatsapp = new FakeWhatsApp();
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Bonjour"));
      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bonjour, comment puis-je vous aider ?"]);
    });
  });

  describe("localisation de la boutique", () => {
    async function orgWithShopLocation() {
      const { organization } = await createTestOrganization();
      await prisma.aiSettings.update({
        where: { organizationId: organization.id },
        data: { shopLatitude: 4.0511, shopLongitude: 9.7679, shopLocationLabel: "Salon Éclat — Akwa" },
      });
      return organization;
    }

    it("envoie la position GPS quand le client demande où se trouve la boutique", async () => {
      const organization = await orgWithShopLocation();
      installScriptedAi([aiReply({ reply: "Nous sommes à Akwa, je vous envoie la position." })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous êtes où exactement ?"));

      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text", "location"]);
      expect(whatsapp.sent[1]).toMatchObject({ latitude: 4.0511, longitude: 9.7679, text: "Salon Éclat — Akwa" });
    });

    it("n'envoie pas de position pour une question sans rapport", async () => {
      const organization = await orgWithShopLocation();
      installScriptedAi([aiReply({ reply: "La coupe coûte 5 000 FCFA." })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Combien coûte la coupe ?"));

      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text"]);
    });

    it("n'envoie rien quand le propriétaire n'a pas configuré de position", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply({ reply: "Bonjour !" })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous êtes où ?"));

      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text"]);
    });
  });

  describe("négociation de prix", () => {
    async function orgWithNegotiation(maxDiscountPercent = 10) {
      const { organization } = await createTestOrganization();
      await prisma.aiSettings.update({
        where: { organizationId: organization.id },
        data: { negotiationEnabled: true, negotiationMaxDiscountPercent: maxDiscountPercent },
      });
      const product = await prisma.product.create({
        data: { organizationId: organization.id, name: "Robe wax", description: "Robe élégante", price: "25 000 FCFA" },
      });
      return { organization, product };
    }

    it("baisse le prix calculé par le serveur quand le client marchande, sans jamais le dévoiler à l'IA", async () => {
      const { organization, product } = await orgWithNegotiation();
      const calls = installScriptedAi([
        aiReply({ reply: "C'est notre meilleur prix, 25 000 FCFA.", productId: product.id, wantsDiscount: true }),
        aiReply({ reply: "Pour vous, je descends à 23 900 FCFA." }),
      ]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "C'est trop cher, un meilleur prix ?"));

      expect(calls).toHaveLength(2);
      expect(calls[1]!.systemPrompt).toContain("23900");
      expect(whatsapp.sent.map((item) => item.kind)).toEqual(["text"]);
      expect(whatsapp.sent[0]!.text).toContain("23 900");

      const conversation = await prisma.conversation.findFirstOrThrow();
      expect(conversation.negotiationState).toMatchObject({ productId: product.id, round: 1, currentPrice: 23900, floorPrice: 22500 });
    });

    it("ne négocie pas quand la fonctionnalité est désactivée", async () => {
      const { organization, product } = await orgWithNegotiation();
      await prisma.aiSettings.update({ where: { organizationId: organization.id }, data: { negotiationEnabled: false } });
      const calls = installScriptedAi([aiReply({ reply: "25 000 FCFA.", productId: product.id, wantsDiscount: true })]);

      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Un meilleur prix ?"));

      expect(calls).toHaveLength(1);
    });

    it("ne négocie pas quand le prix du produit n'est pas un montant exploitable", async () => {
      const { organization } = await orgWithNegotiation();
      const product = await prisma.product.create({
        data: { organizationId: organization.id, name: "Service sur mesure", description: "Sur devis", price: "Sur devis" },
      });
      const calls = installScriptedAi([aiReply({ reply: "Je vous fais un devis.", productId: product.id, wantsDiscount: true })]);

      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Un meilleur prix ?"));

      expect(calls).toHaveLength(1);
    });

    it("tient le prix plancher après le nombre maximal de tours de négociation sur la même conversation", async () => {
      const { organization, product } = await orgWithNegotiation();

      installScriptedAi([
        aiReply({ reply: "25 000 FCFA.", productId: product.id, wantsDiscount: true }),
        aiReply({ reply: "23 900 FCFA pour vous." }),
      ]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Un meilleur prix ?"));

      installScriptedAi([
        aiReply({ reply: "C'est déjà notre prix réduit.", productId: product.id, wantsDiscount: true }),
        aiReply({ reply: "23 300 FCFA, allez." }),
      ]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Encore un effort ?"));

      installScriptedAi([
        aiReply({ reply: "Je ne peux pas descendre plus.", productId: product.id, wantsDiscount: true }),
        aiReply({ reply: "22 500 FCFA, c'est mon dernier prix." }),
      ]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "S'il vous plaît, un petit effort ?"));

      const conversation = await prisma.conversation.findFirstOrThrow();
      expect(conversation.negotiationState).toMatchObject({ round: 3, currentPrice: 22500, floorPrice: 22500 });
    });
  });

  describe("étiquettes de suivi", () => {
    it("passe de Nouveau à Intéressé après une demande de prix", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply({ intent: "demande_prix", reply: "5 000 FCFA." })]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "C'est combien ?"));
      expect((await prisma.conversation.findFirstOrThrow()).stage).toBe("INTERESTED");
    });

    it("passe à A commandé quand une commande est enregistrée", async () => {
      const { organization } = await createTestOrganization();
      const product = await prisma.product.create({ data: { organizationId: organization.id, name: "Soin hydratant", description: "Soin", price: "3 500 FCFA" } });
      await prisma.orderSettings.create({ data: { organizationId: organization.id, enabled: true } });
      installScriptedAi([
        aiReply({
          reply: "Commande confirmée !",
          intent: "achat",
          order: { action: "create", items: [{ productId: product.id, quantity: 2 }], customerName: "Amina", address: "Bonamoussadi" },
        }),
      ]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Je confirme ma commande"));

      expect(await prisma.order.count()).toBe(1);
      expect((await prisma.conversation.findFirstOrThrow()).stage).toBe("ORDERED");
      expect(whatsapp.sent[0]?.text).toContain("Commande enregistrée");
      const reply = await prisma.message.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
      expect(reply.aiMeta).toMatchObject({ actions: [{ type: "order", result: "create" }] });
    });

    it("respecte l'étiquette fixée à la main par le propriétaire", async () => {
      const { organization } = await createTestOrganization();
      installScriptedAi([aiReply({ intent: "demande_prix" }), aiReply({ intent: "achat", needsHuman: true, nextAction: "handoff" })]);
      const whatsapp = new FakeWhatsApp();
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Bonjour, c'est combien ?"));
      const conversation = await prisma.conversation.findFirstOrThrow();
      await prisma.conversation.update({ where: { id: conversation.id }, data: { stage: "NEW", stageLocked: true } });

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Je veux acheter"));

      expect((await prisma.conversation.findFirstOrThrow()).stage).toBe("NEW");
    });
  });

  describe("horaires d'ouverture", () => {
    it("dit à l'IA que l'entreprise est fermée avec la prochaine ouverture", async () => {
      const { organization } = await createTestOrganization();
      // Aucune plage ouverte le jour de la semaine courant → fermé quoi qu'il arrive.
      await prisma.aiSettings.update({
        where: { organizationId: organization.id },
        data: { businessHoursEnabled: true, businessHours: { mon: [{ start: "00:00", end: "00:01" }] }, closedMessage: "Proposer de laisser un message." },
      });
      const calls = installScriptedAi([aiReply()]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Vous êtes ouverts ?"));
      expect(calls[0]?.systemPrompt).toContain("HORAIRES D'OUVERTURE");
      expect(calls[0]?.systemPrompt).toContain("FERMÉE");
      expect(calls[0]?.systemPrompt).toContain("Proposer de laisser un message.");
    });

    it("n'ajoute rien quand les horaires sont désactivés", async () => {
      const { organization } = await createTestOrganization();
      const calls = installScriptedAi([aiReply()]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Bonjour, vous êtes où ?"));
      expect(calls[0]?.systemPrompt).not.toContain("HORAIRES D'OUVERTURE");
    });
  });

  describe("mémoire de l'assistant", () => {
    it("applique les corrections du propriétaire pertinentes, et seulement celles de cette entreprise", async () => {
      const { organization } = await createTestOrganization();
      const other = await createTestOrganization("Autre entreprise");
      await prisma.aiCorrection.create({ data: { organizationId: organization.id, question: "Vous livrez à Bonamoussadi ?", correctReply: "Oui, livraison à Bonamoussadi pour 1 000 FCFA." } });
      await prisma.aiCorrection.create({ data: { organizationId: organization.id, question: "", correctReply: "Toujours vouvoyer le client." } });
      await prisma.aiCorrection.create({ data: { organizationId: other.organization.id, question: "Vous livrez à Bonamoussadi ?", correctReply: "SECRET AUTRE ENTREPRISE" } });
      const calls = installScriptedAi([aiReply()]);

      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Est-ce que vous livrez à Bonamoussadi ?"));

      expect(calls[0]?.systemPrompt).toContain("CORRECTIONS DU PROPRIÉTAIRE");
      expect(calls[0]?.systemPrompt).toContain("livraison à Bonamoussadi pour 1 000 FCFA");
      expect(calls[0]?.systemPrompt).toContain("Toujours vouvoyer le client.");
      expect(calls[0]?.systemPrompt).not.toContain("SECRET AUTRE ENTREPRISE");
      const meta = (await prisma.message.findFirstOrThrow({ where: { direction: "OUTBOUND" } })).aiMeta as { correctionsUsed: number };
      expect(meta.correctionsUsed).toBe(2);
    });

    it("s'inspire des conversations passées terminées par une commande, sans données personnelles", async () => {
      const { organization } = await createTestOrganization();
      const contact = await prisma.contact.create({ data: { organizationId: organization.id, whatsappJid: "237699000009@s.whatsapp.net" } });
      const won = await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id, stage: "ORDERED" } });
      await prisma.message.createMany({
        data: [
          { conversationId: won.id, direction: "INBOUND", author: "CONTACT", type: "TEXT", content: "Vous faites les tresses africaines ?", createdAt: new Date("2026-10-01T10:00:00Z") },
          { conversationId: won.id, direction: "OUTBOUND", author: "AI", type: "TEXT", content: "Oui, à partir de 8 000 FCFA. Appelez le 655 00 00 07 pour réserver.", createdAt: new Date("2026-10-01T10:00:05Z") },
        ],
      });
      const lost = await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id, stage: "INTERESTED" } });
      await prisma.message.createMany({
        data: [
          { conversationId: lost.id, direction: "INBOUND", author: "CONTACT", type: "TEXT", content: "Vous faites les tresses africaines ?", createdAt: new Date("2026-10-02T10:00:00Z") },
          { conversationId: lost.id, direction: "OUTBOUND", author: "AI", type: "TEXT", content: "MAUVAIS EXEMPLE conversation sans suite.", createdAt: new Date("2026-10-02T10:00:05Z") },
        ],
      });
      const calls = installScriptedAi([aiReply()]);

      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Est-ce que vous faites des tresses ?"));

      const prompt = calls[0]?.systemPrompt ?? "";
      expect(prompt).toContain("EXEMPLES D'ÉCHANGES RÉUSSIS");
      expect(prompt).toContain("à partir de 8 000 FCFA");
      expect(prompt).not.toContain("655 00 00 07");
      expect(prompt).not.toContain("MAUVAIS EXEMPLE");
    });
  });

  describe("forfaits : messages de l'assistant", () => {
    beforeEach(() => setBillingEnforcedForTests(true));
    afterAll(() => setBillingEnforcedForTests(null));

    async function orgWithCredits(credits: number) {
      const { organization } = await createTestOrganization();
      await prisma.organization.update({ where: { id: organization.id }, data: { freeAiResponsesRemaining: credits } });
      return organization;
    }
    const credits = async (organizationId: string) => (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).freeAiResponsesRemaining;

    it("sans message restant, l'assistant se tait, le message du client est gardé et le propriétaire est prévenu une seule fois", async () => {
      const organization = await orgWithCredits(0);
      const calls = installScriptedAi([aiReply()]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Bonjour, vous livrez ?"));
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Il y a quelqu'un ?"));
      await flushEmails();

      expect(calls).toHaveLength(0); // l'IA n'est même pas appelée : aucun coût
      expect(whatsapp.sent).toHaveLength(0);
      expect(await prisma.message.count({ where: { direction: "INBOUND" } })).toBe(2);
      expect(hoisted.sentEmails).toHaveLength(1);
      expect(hoisted.sentEmails[0]).toMatchObject({ subject: expect.stringContaining("essai gratuit est terminé") });
    });

    it("avec 2 messages d'essai : répond deux fois, décompte chaque réponse, puis se tait", async () => {
      const organization = await orgWithCredits(2);
      installScriptedAi([aiReply({ reply: "Oui, nous livrons." })]);
      const whatsapp = new FakeWhatsApp();

      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Vous livrez ?"));
      expect(await credits(organization.id)).toBe(1);
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "À Akwa ?"));
      expect(await credits(organization.id)).toBe(0);
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Et le dimanche ?"));
      await flushEmails();

      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Oui, nous livrons.", "Oui, nous livrons."]);
      expect(hoisted.sentEmails).toHaveLength(1);
    });

    it("une panne de l'IA ne coûte aucun message au client", async () => {
      const organization = await orgWithCredits(3);
      installScriptedAi([aiReply({ reply: "Désolé, une erreur est survenue.", intent: "erreur_traitement" })]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Bonjour, je voudrais un prix"));
      expect(await credits(organization.id)).toBe(3);
    });

    it("un message d'accueil seul (simple « bonjour ») ne coûte rien", async () => {
      const organization = await orgWithCredits(3);
      await prisma.aiSettings.update({ where: { organizationId: organization.id }, data: { welcomeMessage: "Bienvenue 👋" } });
      installScriptedAi([aiReply()]);
      const whatsapp = new FakeWhatsApp();
      await deliver(organization.id, whatsapp, inbound(JID_NUMBER, "Bonjour"));
      expect(whatsapp.sent.map((item) => item.text)).toEqual(["Bienvenue 👋"]);
      expect(await credits(organization.id)).toBe(3);
    });

    it("avec un forfait actif, chaque réponse est comptée dans le quota du mois", async () => {
      const { organization } = await createTestOrganization();
      await prisma.billingSubscription.create({ data: { organizationId: organization.id, plan: "starter", messageLimit: 1000, expiresAt: new Date(Date.now() + 20 * 24 * 3600_000) } });
      installScriptedAi([aiReply()]);
      await deliver(organization.id, new FakeWhatsApp(), inbound(JID_NUMBER, "Bonjour, quel est le prix ?"));
      expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId: organization.id } })).messagesUsed).toBe(1);
    });
  });
});
