import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { cancelBroadcast, createBroadcast, findAudience, previewBroadcast, resumeBroadcasts, runBroadcast } from "./broadcasts.service.js";

const NOW = new Date("2026-10-14T10:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 3600_000);

let counter = 0;
async function seedClient(organizationId: string, overrides: { daysSinceMessage?: number; stage?: "NEW" | "INTERESTED" | "ORDERED" | "CALLBACK"; optedOut?: boolean; jid?: string } = {}) {
  counter += 1;
  const jid = overrides.jid ?? `2376550${String(counter).padStart(5, "0")}@s.whatsapp.net`;
  const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: jid, optedOut: overrides.optedOut ?? false } });
  const conversation = await prisma.conversation.create({
    data: { organizationId, contactId: contact.id, stage: overrides.stage ?? "NEW", lastInboundAt: daysAgo(overrides.daysSinceMessage ?? 2) },
  });
  return { contact, conversation };
}

function makeDeps(options: { connected?: () => boolean; failFor?: string[] } = {}) {
  const sent: Array<{ jid: string; text: string }> = [];
  const sleeps: number[] = [];
  return {
    sent,
    sleeps,
    deps: {
      isConnected: options.connected ?? (() => true),
      send: async (_organizationId: string, jid: string, text: string) => {
        if (options.failFor?.includes(jid)) throw new Error("numéro invalide");
        sent.push({ jid, text });
      },
      sleep: async (ms: number) => { sleeps.push(ms); },
      random: () => 0.5,
    },
  };
}

describe.skipIf(!integrationEnabled)("messages groupés (base réelle)", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await disconnectTestDatabase(); });

  describe("qui peut recevoir un message groupé", () => {
    it("seulement les clients qui ont écrit récemment, sans STOP, avec un vrai numéro WhatsApp", async () => {
      const { organization } = await createTestOrganization();
      const recent = await seedClient(organization.id, { daysSinceMessage: 5 });
      await seedClient(organization.id, { daysSinceMessage: 45 });
      await seedClient(organization.id, { optedOut: true });
      await seedClient(organization.id, { jid: "9876543@lid" });
      const audience = await findAudience(organization.id, {}, NOW);
      expect(audience.map((entry) => entry.contactId)).toEqual([recent.contact.id]);
    });

    it("filtre par étiquette et par période, et ne mélange pas les entreprises", async () => {
      const { organization } = await createTestOrganization();
      const other = await createTestOrganization("Autre");
      const interested = await seedClient(organization.id, { stage: "INTERESTED" });
      await seedClient(organization.id, { stage: "ORDERED" });
      await seedClient(other.organization.id, { stage: "INTERESTED" });
      const old = await seedClient(organization.id, { stage: "INTERESTED", daysSinceMessage: 40 });

      expect((await findAudience(organization.id, { stages: ["INTERESTED"] }, NOW)).map((entry) => entry.contactId)).toEqual([interested.contact.id]);
      expect((await findAudience(organization.id, { stages: ["INTERESTED"], windowDays: 60 }, NOW)).map((entry) => entry.contactId).sort()).toEqual([interested.contact.id, old.contact.id].sort());
    });

    it("compte un client une seule fois même avec plusieurs conversations", async () => {
      const { organization } = await createTestOrganization();
      const { contact } = await seedClient(organization.id);
      await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id, lastInboundAt: daysAgo(1) } });
      expect(await findAudience(organization.id, {}, NOW)).toHaveLength(1);
    });
  });

  describe("préparation d'un envoi", () => {
    it("annonce combien de clients seront contactés et les limites", async () => {
      const { organization } = await createTestOrganization();
      for (let index = 0; index < 3; index += 1) await seedClient(organization.id);
      const preview = await previewBroadcast(organization.id, {}, NOW);
      expect(preview).toMatchObject({ recipients: 3, eligible: 3, remaining: 0, alreadyReceived: 0, ok: true, remainingToday: 100, limits: { maxRecipientsPerBroadcast: 50, maxPerDay: 100 } });
    });

    it("refuse un message vide, trop long, ou sans destinataire", async () => {
      const { organization } = await createTestOrganization();
      await expect(createBroadcast(organization.id, { text: "  " }, NOW)).rejects.toThrow("Écrivez le message");
      await expect(createBroadcast(organization.id, { text: "x".repeat(1001) }, NOW)).rejects.toThrow("trop long");
      await expect(createBroadcast(organization.id, { text: "Promo" }, NOW)).rejects.toThrow("Aucun client");
    });

    it("avec plus de 50 clients, le premier envoi part aux 50 plus récents au lieu d'être bloqué", async () => {
      const { organization } = await createTestOrganization();
      const clients = [];
      for (let index = 0; index < 60; index += 1) clients.push(await seedClient(organization.id, { daysSinceMessage: 1 + index / 100 }));
      const preview = await previewBroadcast(organization.id, { text: "Promo" }, NOW);
      expect(preview).toMatchObject({ ok: true, eligible: 60, recipients: 50, remaining: 10 });

      const broadcast = await createBroadcast(organization.id, { text: "Promo" }, NOW);
      expect(broadcast.total).toBe(50);
      const recipients = await prisma.broadcastRecipient.findMany({ where: { broadcastId: broadcast.id } });
      const chosen = new Set(recipients.map((recipient) => recipient.contactId));
      expect(chosen.size).toBe(50);
      for (const client of clients.slice(0, 50)) expect(chosen.has(client.contact.id)).toBe(true); // les plus récents
      for (const client of clients.slice(50)) expect(chosen.has(client.contact.id)).toBe(false);
    });

    it("renvoyer le même message envoie le lot suivant, sans doublon", async () => {
      const { organization } = await createTestOrganization();
      for (let index = 0; index < 60; index += 1) await seedClient(organization.id, { daysSinceMessage: 1 + index / 100 });
      const first = await createBroadcast(organization.id, { text: "Promo du jour" }, NOW);
      await runBroadcast(first.id, makeDeps().deps);
      expect(await prisma.broadcast.findUnique({ where: { id: first.id } })).toMatchObject({ status: "DONE", sentCount: 50 });

      const preview = await previewBroadcast(organization.id, { text: "  promo   DU jour " }, NOW); // même texte, autre mise en forme
      expect(preview).toMatchObject({ ok: true, eligible: 10, recipients: 10, remaining: 0, alreadyReceived: 50 });

      const second = await createBroadcast(organization.id, { text: "Promo du jour" }, NOW);
      expect(second.total).toBe(10);
      const secondDeps = makeDeps();
      await runBroadcast(second.id, secondDeps.deps);
      const firstJids = new Set((await prisma.broadcastRecipient.findMany({ where: { broadcastId: first.id } })).map((recipient) => recipient.jid));
      expect(secondDeps.sent.every((entry) => !firstJids.has(entry.jid))).toBe(true);

      const third = previewBroadcast(organization.id, { text: "Promo du jour" }, NOW);
      await expect(third).resolves.toMatchObject({ ok: false, eligible: 0, alreadyReceived: 60, reason: expect.stringContaining("ont déjà reçu ce message") });
      await expect(createBroadcast(organization.id, { text: "Promo du jour" }, NOW)).rejects.toThrow("déjà reçu ce message");
    });

    it("un message différent est envoyé à tout le monde, même à ceux qui ont reçu le précédent", async () => {
      const { organization } = await createTestOrganization();
      for (let index = 0; index < 5; index += 1) await seedClient(organization.id);
      const first = await createBroadcast(organization.id, { text: "Promo A" }, NOW);
      await runBroadcast(first.id, makeDeps().deps);
      expect(await previewBroadcast(organization.id, { text: "Promo B" }, NOW)).toMatchObject({ ok: true, recipients: 5, alreadyReceived: 0 });
    });

    it("un client qui n'a pas reçu le message (envoi annulé ou en échec) peut encore le recevoir", async () => {
      const { organization } = await createTestOrganization();
      for (let index = 0; index < 3; index += 1) await seedClient(organization.id);
      const first = await createBroadcast(organization.id, { text: "Promo" }, NOW);
      await cancelBroadcast(organization.id, first.id);
      expect(await previewBroadcast(organization.id, { text: "Promo" }, NOW)).toMatchObject({ ok: true, recipients: 3, alreadyReceived: 0 });
    });

    it("refuse un second envoi tant que le premier est en cours", async () => {
      const { organization } = await createTestOrganization();
      await seedClient(organization.id);
      await createBroadcast(organization.id, { text: "Promo 1" }, NOW);
      await expect(createBroadcast(organization.id, { text: "Promo 2" }, NOW)).rejects.toThrow("déjà en cours");
    });

    async function sentToday(organizationId: string, count: number) {
      const earlier = await prisma.broadcast.create({ data: { organizationId, text: "Ancien", status: "DONE", total: count, sentCount: count } });
      const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: "237600000000@s.whatsapp.net" } });
      await prisma.broadcastRecipient.createMany({
        data: Array.from({ length: count }, () => ({ broadcastId: earlier.id, contactId: contact.id, jid: contact.whatsappJid, status: "SENT" as const, sentAt: new Date(NOW.getTime() - 3600_000) })),
      });
    }

    it("réduit le lot à ce qu'il reste de la limite de 100 messages par 24 h", async () => {
      const { organization } = await createTestOrganization();
      await sentToday(organization.id, 90);
      for (let index = 0; index < 11; index += 1) await seedClient(organization.id);
      expect(await previewBroadcast(organization.id, { text: "Promo" }, NOW)).toMatchObject({ ok: true, eligible: 11, recipients: 10, remaining: 1, remainingToday: 10 });
      const broadcast = await createBroadcast(organization.id, { text: "Promo" }, NOW);
      expect(broadcast.total).toBe(10);
    });

    it("explique quand les 100 messages par 24 h sont atteints", async () => {
      const { organization } = await createTestOrganization();
      await sentToday(organization.id, 100);
      await seedClient(organization.id);
      await expect(createBroadcast(organization.id, { text: "Promo" }, NOW)).rejects.toThrow("Limite de 100 messages");
      expect(await previewBroadcast(organization.id, { text: "Promo" }, NOW)).toMatchObject({ ok: false, recipients: 0, eligible: 1, remaining: 1 });
    });
  });

  describe("envoi", () => {
    it("envoie à chaque client une seule fois, avec la mention STOP et une pause entre deux envois", async () => {
      const { organization } = await createTestOrganization();
      const a = await seedClient(organization.id);
      const b = await seedClient(organization.id);
      const broadcast = await createBroadcast(organization.id, { text: "Promo ce week-end : -10 %" }, NOW);
      const { deps, sent, sleeps } = makeDeps();

      await runBroadcast(broadcast.id, deps);
      await runBroadcast(broadcast.id, deps); // relancer ne renvoie rien

      expect(sent.map((entry) => entry.jid).sort()).toEqual([a.contact.whatsappJid, b.contact.whatsappJid].sort());
      expect(sent.every((entry) => entry.text.startsWith("Promo ce week-end : -10 %") && entry.text.endsWith("répondez STOP."))).toBe(true);
      expect(sleeps).toEqual([14_000]); // une seule pause : pas après le dernier
      const done = await prisma.broadcast.findUniqueOrThrow({ where: { id: broadcast.id } });
      expect(done).toMatchObject({ status: "DONE", sentCount: 2, failedCount: 0 });
      expect(done.finishedAt).toBeInstanceOf(Date);
    });

    it("garde le message dans la conversation de chaque client, marqué comme message groupé", async () => {
      const { organization } = await createTestOrganization();
      const { conversation } = await seedClient(organization.id);
      const broadcast = await createBroadcast(organization.id, { text: "Promo" }, NOW);
      await runBroadcast(broadcast.id, makeDeps().deps);
      const message = await prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id } });
      expect(message).toMatchObject({ direction: "OUTBOUND", author: "HUMAN" });
      expect(message.aiMeta).toMatchObject({ kind: "broadcast", broadcastId: broadcast.id });
    });

    it("saute un client qui écrit STOP pendant l'envoi", async () => {
      const { organization } = await createTestOrganization();
      const a = await seedClient(organization.id);
      await seedClient(organization.id);
      const broadcast = await createBroadcast(organization.id, { text: "Promo" }, NOW);
      await prisma.contact.update({ where: { id: a.contact.id }, data: { optedOut: true } });
      const { deps, sent } = makeDeps();
      await runBroadcast(broadcast.id, deps);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.jid).not.toBe(a.contact.whatsappJid);
      expect((await prisma.broadcast.findUniqueOrThrow({ where: { id: broadcast.id } })).sentCount).toBe(1);
    });

    it("compte les échecs sans arrêter l'envoi", async () => {
      const { organization } = await createTestOrganization();
      const bad = await seedClient(organization.id);
      await seedClient(organization.id);
      const broadcast = await createBroadcast(organization.id, { text: "Promo" }, NOW);
      const { deps, sent } = makeDeps({ failFor: [bad.contact.whatsappJid] });
      await runBroadcast(broadcast.id, deps);
      expect(sent).toHaveLength(1);
      expect(await prisma.broadcast.findUniqueOrThrow({ where: { id: broadcast.id } })).toMatchObject({ status: "DONE", sentCount: 1, failedCount: 1 });
    });

    it("se met en pause quand WhatsApp est déconnecté, puis reprend sans rien renvoyer en double", async () => {
      const { organization } = await createTestOrganization();
      await seedClient(organization.id);
      await seedClient(organization.id);
      const broadcast = await createBroadcast(organization.id, { text: "Promo" }, NOW);
      let connected = true;
      const sent: string[] = [];
      const deps = {
        isConnected: () => connected,
        send: async (_org: string, jid: string) => { sent.push(jid); connected = false; },
        sleep: async () => {},
        random: () => 0,
      };

      await runBroadcast(broadcast.id, deps);
      expect(sent).toHaveLength(1);
      expect((await prisma.broadcast.findUniqueOrThrow({ where: { id: broadcast.id } })).status).toBe("SENDING");

      connected = true;
      expect(await resumeBroadcasts(deps)).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(sent).toHaveLength(2);
      expect(new Set(sent).size).toBe(2);
      expect((await prisma.broadcast.findUniqueOrThrow({ where: { id: broadcast.id } })).status).toBe("DONE");
    });

    it("peut être annulé : les clients restants ne reçoivent rien", async () => {
      const { organization } = await createTestOrganization();
      await seedClient(organization.id);
      await seedClient(organization.id);
      const broadcast = await createBroadcast(organization.id, { text: "Promo" }, NOW);
      const cancelled = await cancelBroadcast(organization.id, broadcast.id);
      const { deps, sent } = makeDeps();
      await runBroadcast(broadcast.id, deps);
      expect(cancelled.status).toBe("CANCELLED");
      expect(sent).toEqual([]);
      expect(await prisma.broadcastRecipient.count({ where: { broadcastId: broadcast.id, status: "SKIPPED" } })).toBe(2);
    });

    it("ne laisse pas une entreprise annuler l'envoi d'une autre", async () => {
      const { organization } = await createTestOrganization();
      const other = await createTestOrganization("Autre");
      await seedClient(organization.id);
      const broadcast = await createBroadcast(organization.id, { text: "Promo" }, NOW);
      await expect(cancelBroadcast(other.organization.id, broadcast.id)).rejects.toThrow("introuvable");
    });
  });
});
