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

export interface QuotaCheck {
  ok: boolean;
  /** Combien de messages peuvent encore partir aujourd'hui. */
  remainingToday: number;
  reason?: string;
}

export function checkBroadcastQuota(input: { recipients: number; sentLast24h: number; pendingNow: number }): QuotaCheck {
  const { maxRecipientsPerBroadcast, maxPerDay } = BROADCAST_LIMITS;
  const remainingToday = Math.max(0, maxPerDay - input.sentLast24h - input.pendingNow);
  if (input.recipients < 1) return { ok: false, remainingToday, reason: "Aucun client à contacter avec ces critères." };
  if (input.recipients > maxRecipientsPerBroadcast) {
    return { ok: false, remainingToday, reason: `Un envoi est limité à ${maxRecipientsPerBroadcast} clients pour protéger votre numéro WhatsApp. Choisissez un groupe plus petit.` };
  }
  if (input.recipients > remainingToday) {
    return { ok: false, remainingToday, reason: `Limite de ${maxPerDay} messages groupés par jour atteinte (il en reste ${remainingToday} aujourd'hui).` };
  }
  return { ok: true, remainingToday };
}
