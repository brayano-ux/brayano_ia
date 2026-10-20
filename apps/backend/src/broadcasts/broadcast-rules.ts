/**
 * Garde-fous des messages groupés. WhatsApp bloque les numéros qui écrivent en masse à des personnes qui ne les
 * attendent pas : on limite donc volontairement ce qui peut partir, et on le dit clairement au propriétaire.
 */
export const BROADCAST_LIMITS = {
  /** Destinataires maximum pour un même envoi. */
  maxRecipientsPerBroadcast: 50,
  /** Messages groupés maximum sur 24 heures pour une entreprise (tous envois confondus). */
  maxPerDay: 100,
  /** Le client doit avoir écrit à l'entreprise dans cette période pour être contacté. */
  defaultWindowDays: 30,
  maxWindowDays: 60,
  /** Pause aléatoire entre deux messages (millisecondes). */
  minDelayMs: 8_000,
  maxDelayMs: 20_000,
  maxTextLength: 1000,
  /** Un client qui a déjà reçu exactement ce message depuis moins de ce délai (en jours) ne le reçoit pas une seconde fois. */
  sameMessageWindowDays: 30,
} as const;

export const OPT_OUT_FOOTER = "\n\nPour ne plus recevoir nos messages, répondez STOP.";

export function withOptOutFooter(text: string): string {
  return `${text.trim()}${OPT_OUT_FOOTER}`;
}

/** Délai aléatoire borné entre deux envois. `random` : valeur entre 0 et 1 (injectable pour les tests). */
export function pickDelayMs(random: number = Math.random()): number {
  const { minDelayMs, maxDelayMs } = BROADCAST_LIMITS;
  return Math.round(minDelayMs + Math.min(1, Math.max(0, random)) * (maxDelayMs - minDelayMs));
}

export interface BatchPlan {
  ok: boolean;
  /** Combien de clients recevront le message dans CET envoi. */
  batchSize: number;
  /** Combien de clients éligibles resteront à contacter par un prochain envoi du même message. */
  remaining: number;
  /** Combien de messages peuvent encore partir aujourd'hui (24 h glissantes). */
  remainingToday: number;
  reason?: string;
}

/**
 * Un envoi part toujours par lots : au plus `maxRecipientsPerBroadcast` clients, et jamais plus que ce qu'il reste de la
 * limite des 24 h. Le propriétaire n'est donc jamais bloqué quand son groupe est plus grand : il envoie le premier lot,
 * puis renvoie le même message (les clients déjà servis sont exclus automatiquement) pour les lots suivants.
 */
export function planBroadcastBatch(input: { eligible: number; sentLast24h: number; pendingNow: number }): BatchPlan {
  const { maxRecipientsPerBroadcast, maxPerDay } = BROADCAST_LIMITS;
  const remainingToday = Math.max(0, maxPerDay - input.sentLast24h - input.pendingNow);
  if (input.eligible < 1) return { ok: false, batchSize: 0, remaining: 0, remainingToday, reason: "Aucun client à contacter avec ces critères." };
  if (remainingToday < 1) {
    return { ok: false, batchSize: 0, remaining: input.eligible, remainingToday, reason: `Limite de ${maxPerDay} messages groupés par 24 h atteinte pour protéger votre numéro WhatsApp. Réessayez plus tard : les clients restants pourront alors recevoir le message.` };
  }
  const batchSize = Math.min(input.eligible, maxRecipientsPerBroadcast, remainingToday);
  return { ok: true, batchSize, remaining: input.eligible - batchSize, remainingToday };
}
