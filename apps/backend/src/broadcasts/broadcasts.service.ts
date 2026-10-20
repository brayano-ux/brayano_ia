import { withConversationSendLock } from "../conversations/conversation-send-lock.js";
import { prisma } from "../database/client.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { BROADCAST_LIMITS, pickDelayMs, planBroadcastBatch, withOptOutFooter } from "./broadcast-rules.js";

export type BroadcastStage = "NEW" | "INTERESTED" | "ORDERED" | "CALLBACK";

export interface AudienceFilter {
  stages?: BroadcastStage[] | undefined;
  windowDays?: number | undefined;
  /** Texte du message : les clients qui l'ont déjà reçu (mot pour mot) récemment sont exclus, pour envoyer un grand groupe par lots. */
  text?: string | undefined;
}

export interface BroadcastDeps {
  isConnected: (organizationId: string) => boolean;
  send: (organizationId: string, jid: string, text: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

function windowStart(windowDays: number | undefined, now: Date) {
  const days = Math.min(BROADCAST_LIMITS.maxWindowDays, Math.max(1, windowDays ?? BROADCAST_LIMITS.defaultWindowDays));
  return new Date(now.getTime() - days * 24 * 3600_000);
}

function normalizeText(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Contacts qui ont déjà reçu ce même message (casse et espaces ignorés) dans les derniers jours. */
async function contactsAlreadyReceived(organizationId: string, text: string, now: Date) {
  const since = new Date(now.getTime() - BROADCAST_LIMITS.sameMessageWindowDays * 24 * 3600_000);
  const wanted = normalizeText(text);
  const broadcasts = await prisma.broadcast.findMany({
    where: { organizationId, createdAt: { gte: since } },
    select: { text: true, recipients: { where: { status: "SENT" }, select: { contactId: true } } },
  });
  const received = new Set<string>();
  for (const broadcast of broadcasts) {
    if (normalizeText(broadcast.text) !== wanted) continue;
    for (const recipient of broadcast.recipients) received.add(recipient.contactId);
  }
  return received;
}

/**
 * Clients qui peuvent recevoir un message groupé : ils ont écrit à l'entreprise récemment (ils la connaissent),
 * n'ont pas écrit STOP, et ont un vrai numéro WhatsApp. Un client = une ligne même s'il a plusieurs conversations.
 * Avec `filter.text`, ceux qui ont déjà reçu ce message exact sont écartés (`alreadyReceived` les compte).
 */
export async function findAudienceDetailed(organizationId: string, filter: AudienceFilter = {}, now = new Date()) {
  const conversations = await prisma.conversation.findMany({
    where: {
      organizationId,
      lastInboundAt: { gte: windowStart(filter.windowDays, now) },
      ...(filter.stages?.length ? { stage: { in: filter.stages } } : {}),
      contact: { optedOut: false, whatsappJid: { endsWith: "@s.whatsapp.net" } },
    },
    select: { id: true, contactId: true, contact: { select: { whatsappJid: true, displayName: true } } },
    orderBy: { lastInboundAt: "desc" },
    take: 1000,
  });
  const byContact = new Map<string, { contactId: string; conversationId: string; jid: string; name: string | null }>();
  for (const conversation of conversations) {
    if (!byContact.has(conversation.contactId)) {
      byContact.set(conversation.contactId, { contactId: conversation.contactId, conversationId: conversation.id, jid: conversation.contact.whatsappJid, name: conversation.contact.displayName });
    }
  }
  const everyone = [...byContact.values()];
  if (!filter.text || !normalizeText(filter.text)) return { audience: everyone, alreadyReceived: 0 };

  const received = await contactsAlreadyReceived(organizationId, filter.text, now);
  const audience = everyone.filter((entry) => !received.has(entry.contactId));
  return { audience, alreadyReceived: everyone.length - audience.length };
}

export async function findAudience(organizationId: string, filter: AudienceFilter = {}, now = new Date()) {
  return (await findAudienceDetailed(organizationId, filter, now)).audience;
}

async function quotaState(organizationId: string, now: Date) {
  const since = new Date(now.getTime() - 24 * 3600_000);
  const [sentLast24h, pendingNow] = await Promise.all([
    prisma.broadcastRecipient.count({ where: { broadcast: { organizationId }, status: "SENT", sentAt: { gte: since } } }),
    prisma.broadcastRecipient.count({ where: { broadcast: { organizationId, status: "SENDING" }, status: "PENDING" } }),
  ]);
  return { sentLast24h, pendingNow };
}

export async function previewBroadcast(organizationId: string, filter: AudienceFilter = {}, now = new Date()) {
  const { audience, alreadyReceived } = await findAudienceDetailed(organizationId, filter, now);
  const plan = planBroadcastBatch({ eligible: audience.length, ...(await quotaState(organizationId, now)) });
  const reason = !plan.ok && audience.length === 0 && alreadyReceived > 0
    ? `Les ${alreadyReceived} client${alreadyReceived > 1 ? "s" : ""} ciblé${alreadyReceived > 1 ? "s" : ""} ont déjà reçu ce message.`
    : plan.reason;
  return {
    /** Combien de clients recevront CET envoi. */
    recipients: plan.batchSize,
    /** Combien de clients au total pourraient le recevoir (ceux qui l'ont déjà reçu sont exclus). */
    eligible: audience.length,
    /** Combien resteront pour un prochain envoi du même message. */
    remaining: plan.remaining,
    alreadyReceived,
    sample: audience.slice(0, Math.min(5, plan.batchSize)).map((entry) => entry.name || entry.jid.split("@")[0]),
    ok: plan.ok,
    remainingToday: plan.remainingToday,
    ...(reason ? { reason } : {}),
    limits: {
      maxRecipientsPerBroadcast: BROADCAST_LIMITS.maxRecipientsPerBroadcast,
      maxPerDay: BROADCAST_LIMITS.maxPerDay,
      windowDays: Math.min(BROADCAST_LIMITS.maxWindowDays, filter.windowDays ?? BROADCAST_LIMITS.defaultWindowDays),
    },
  };
}

/**
 * Prépare l'envoi : vérifie les limites et enregistre les destinataires du lot (les plus récents d'abord).
 * Si le groupe dépasse un lot, seul le premier lot part : renvoyer le même message envoie le lot suivant.
 */
export async function createBroadcast(organizationId: string, input: { text: string } & AudienceFilter, now = new Date()) {
  const text = input.text.trim();
  if (!text) throw new ValidationError("Écrivez le message à envoyer.");
  if (text.length > BROADCAST_LIMITS.maxTextLength) throw new ValidationError(`Le message est trop long (${BROADCAST_LIMITS.maxTextLength} caractères maximum).`);

  const running = await prisma.broadcast.count({ where: { organizationId, status: "SENDING" } });
  if (running > 0) throw new ValidationError("Un envoi est déjà en cours. Attendez qu'il se termine ou annulez-le.");

  const { audience, alreadyReceived } = await findAudienceDetailed(organizationId, { ...input, text }, now);
  const plan = planBroadcastBatch({ eligible: audience.length, ...(await quotaState(organizationId, now)) });
  if (!plan.ok) {
    throw new ValidationError(audience.length === 0 && alreadyReceived > 0 ? "Tous les clients ciblés ont déjà reçu ce message." : plan.reason ?? "Envoi impossible.");
  }
  const batch = audience.slice(0, plan.batchSize);

  return prisma.broadcast.create({
    data: {
      organizationId,
      text,
      total: batch.length,
      recipients: { create: batch.map((entry) => ({ contactId: entry.contactId, jid: entry.jid })) },
    },
  });
}

export async function listBroadcasts(organizationId: string) {
  return prisma.broadcast.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 30 });
}

export async function getBroadcast(organizationId: string, id: string) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id, organizationId } });
  if (!broadcast) throw new NotFoundError("Envoi introuvable.");
  return broadcast;
}

export async function cancelBroadcast(organizationId: string, id: string) {
  const broadcast = await getBroadcast(organizationId, id);
  if (broadcast.status !== "SENDING") return broadcast;
  await prisma.broadcastRecipient.updateMany({ where: { broadcastId: id, status: "PENDING" }, data: { status: "SKIPPED" } });
  return prisma.broadcast.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
}

const activeRuns = new Set<string>();

/**
 * Envoie un message groupé, un destinataire à la fois, avec une pause aléatoire entre deux envois.
 * Peut être relancé sans risque (au démarrage du serveur, ou si WhatsApp était déconnecté) : seuls les destinataires
 * « en attente » partent, une seule fois chacun. Ne lève jamais.
 */
export async function runBroadcast(broadcastId: string, deps: BroadcastDeps): Promise<void> {
  if (activeRuns.has(broadcastId)) return;
  activeRuns.add(broadcastId);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  try {
    for (;;) {
      const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
      if (!broadcast || broadcast.status !== "SENDING") return;
      const next = await prisma.broadcastRecipient.findFirst({ where: { broadcastId, status: "PENDING" }, orderBy: { id: "asc" }, include: { contact: true } });
      if (!next) {
        await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "DONE", finishedAt: new Date() } });
        console.log(`📣 [broadcast:${broadcastId}] Envoi terminé : ${broadcast.sentCount} envoyé(s), ${broadcast.failedCount} échec(s).`);
        return;
      }
      if (!deps.isConnected(broadcast.organizationId)) {
        console.warn(`⏸️  [broadcast:${broadcastId}] WhatsApp déconnecté : envoi en pause.`);
        return;
      }

      if (next.contact.optedOut) {
        await prisma.broadcastRecipient.update({ where: { id: next.id }, data: { status: "SKIPPED", error: "Le client a demandé à ne plus recevoir de messages." } });
        continue;
      }

      let sentOk = false;
      try {
        await deps.send(broadcast.organizationId, next.jid, withOptOutFooter(broadcast.text));
        sentOk = true;
      } catch (error) {
        await prisma.broadcastRecipient.update({ where: { id: next.id }, data: { status: "FAILED", error: String(error instanceof Error ? error.message : error).slice(0, 200) } });
        await prisma.broadcast.update({ where: { id: broadcastId }, data: { failedCount: { increment: 1 } } });
      }

      if (sentOk) {
        await prisma.broadcastRecipient.update({ where: { id: next.id }, data: { status: "SENT", sentAt: new Date() } });
        await prisma.broadcast.update({ where: { id: broadcastId }, data: { sentCount: { increment: 1 } } });
        await recordBroadcastMessage(broadcast.organizationId, next.contactId, withOptOutFooter(broadcast.text), broadcastId);
      }

      const remaining = await prisma.broadcastRecipient.count({ where: { broadcastId, status: "PENDING" } });
      if (remaining > 0) await sleep(pickDelayMs(random()));
    }
  } catch (error) {
    console.error(`❌ [broadcast:${broadcastId}] Envoi interrompu :`, error);
  } finally {
    activeRuns.delete(broadcastId);
  }
}

/** Garde le message groupé dans la conversation du client (il apparaît dans le fil, marqué comme message groupé). */
async function recordBroadcastMessage(organizationId: string, contactId: string, text: string, broadcastId: string) {
  try {
    const conversation = await prisma.conversation.findFirst({ where: { organizationId, contactId }, orderBy: { updatedAt: "desc" }, select: { id: true } });
    if (!conversation) return;
    await withConversationSendLock(conversation.id, () =>
      prisma.message.create({
        data: { conversationId: conversation.id, direction: "OUTBOUND", author: "HUMAN", type: "TEXT", content: text, aiMeta: { kind: "broadcast", broadcastId } },
      }),
    );
  } catch (error) {
    console.error(`❌ [broadcast:${broadcastId}] Message non enregistré dans la conversation :`, error);
  }
}

/** Au démarrage : reprend les envois restés « en cours » (redéploiement, coupure). */
export async function resumeBroadcasts(deps: BroadcastDeps) {
  const running = await prisma.broadcast.findMany({ where: { status: "SENDING" }, select: { id: true } });
  for (const broadcast of running) void runBroadcast(broadcast.id, deps);
  return running.length;
}
