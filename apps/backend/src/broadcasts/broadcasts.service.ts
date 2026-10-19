import { withConversationSendLock } from "../conversations/conversation-send-lock.js";
import { prisma } from "../database/client.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { BROADCAST_LIMITS, checkBroadcastQuota, pickDelayMs, withOptOutFooter } from "./broadcast-rules.js";

export type BroadcastStage = "NEW" | "INTERESTED" | "ORDERED" | "CALLBACK";

export interface AudienceFilter {
  stages?: BroadcastStage[] | undefined;
  windowDays?: number | undefined;
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

/**
 * Clients qui peuvent recevoir un message groupé : ils ont écrit à l'entreprise récemment (ils la connaissent),
 * n'ont pas écrit STOP, et ont un vrai numéro WhatsApp. Un client = une ligne même s'il a plusieurs conversations.
 */
export async function findAudience(organizationId: string, filter: AudienceFilter = {}, now = new Date()) {
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
  return [...byContact.values()];
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
  const audience = await findAudience(organizationId, filter, now);
  const quota = checkBroadcastQuota({ recipients: audience.length, ...(await quotaState(organizationId, now)) });
  return {
    recipients: audience.length,
    sample: audience.slice(0, 5).map((entry) => entry.name || entry.jid.split("@")[0]),
    ...quota,
    limits: {
      maxRecipientsPerBroadcast: BROADCAST_LIMITS.maxRecipientsPerBroadcast,
      maxPerDay: BROADCAST_LIMITS.maxPerDay,
      windowDays: Math.min(BROADCAST_LIMITS.maxWindowDays, filter.windowDays ?? BROADCAST_LIMITS.defaultWindowDays),
    },
  };
}

/** Prépare l'envoi : vérifie les limites, enregistre les destinataires. L'envoi réel est fait par runBroadcast. */
export async function createBroadcast(organizationId: string, input: { text: string } & AudienceFilter, now = new Date()) {
  const text = input.text.trim();
  if (!text) throw new ValidationError("Écrivez le message à envoyer.");
  if (text.length > BROADCAST_LIMITS.maxTextLength) throw new ValidationError(`Le message est trop long (${BROADCAST_LIMITS.maxTextLength} caractères maximum).`);

  const running = await prisma.broadcast.count({ where: { organizationId, status: "SENDING" } });
  if (running > 0) throw new ValidationError("Un envoi est déjà en cours. Attendez qu'il se termine ou annulez-le.");

  const audience = await findAudience(organizationId, input, now);
  const quota = checkBroadcastQuota({ recipients: audience.length, ...(await quotaState(organizationId, now)) });
  if (!quota.ok) throw new ValidationError(quota.reason ?? "Envoi impossible.");

  return prisma.broadcast.create({
    data: {
      organizationId,
      text,
      total: audience.length,
      recipients: { create: audience.map((entry) => ({ contactId: entry.contactId, jid: entry.jid })) },
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
