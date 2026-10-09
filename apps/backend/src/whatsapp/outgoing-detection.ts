import type { HumanOutgoingMessage } from "./whatsapp.types.js";

const MAX_TRACKED_IDS = 2000;
/** Au-delà, un message sortant est de l'historique rejoué (reconnexion), pas une réponse en cours. */
const MAX_MESSAGE_AGE_MS = 2 * 60 * 1000;

/** Identifiants des messages envoyés par l'application elle-même (IA ou dashboard). */
export class BotSentIds {
  private readonly ids = new Set<string>();

  add(id: string): void {
    this.ids.add(id);
    if (this.ids.size > MAX_TRACKED_IDS) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }
}

type RawMessage = {
  key: { id?: string | null; fromMe?: boolean | null; remoteJid?: string | null; remoteJidAlt?: string | null };
  message?: Record<string, any> | null;
  messageTimestamp?: unknown;
};

/** Contenus écrits par une personne. Réactions, suppressions et clés de chiffrement n'en font pas partie. */
const HUMAN_CONTENT_KEYS = [
  "conversation",
  "extendedTextMessage",
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
  "locationMessage",
  "contactMessage",
] as const;

function unwrap(message: Record<string, any>): Record<string, any> {
  return message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message.viewOnceMessageV2?.message ?? message;
}

/**
 * Renvoie le message si c'est un humain qui a écrit à un prospect depuis le téléphone,
 * sinon null (message du robot, groupe, statut, réaction, ancien historique…).
 */
export function extractHumanOutgoing(msg: RawMessage, botSent: BotSentIds, nowMs: number = Date.now()): HumanOutgoingMessage | null {
  if (!msg.key.fromMe || !msg.message || !msg.key.id) return null;
  if (botSent.has(msg.key.id)) return null;

  const toJid = msg.key.remoteJidAlt ?? msg.key.remoteJid;
  if (!toJid || toJid === "status@broadcast" || toJid.endsWith("@g.us") || toJid.endsWith("@newsletter")) return null;

  const content = unwrap(msg.message);
  if (!HUMAN_CONTENT_KEYS.some((key) => content[key] != null)) return null;

  const seconds = Number(msg.messageTimestamp);
  const timestamp = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(nowMs);
  if (nowMs - timestamp.getTime() > MAX_MESSAGE_AGE_MS) return null;

  const text: string | null =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    null;

  return { externalId: msg.key.id, toJid, text: text?.trim() ? text : null, timestamp };
}
