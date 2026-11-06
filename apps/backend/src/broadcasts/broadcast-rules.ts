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
  /** Après une reconnexion WhatsApp, on laisse la connexion se stabiliser avant de reprendre les envois groupés : un
   * envoi massif juste après une reconnexion est un profil d'activité plus suspect pour les systèmes anti-bot. */
  reconnectCooldownMs: 2 * 60_000,
  /** Pendant les premiers jours suivant la toute première connexion d'un numéro, les envois groupés restent réduits :
   * un numéro tout juste lié qui envoie en masse immédiatement est plus risqué qu'un numéro qui monte en charge. */
  warmupWindowDays: 3,
  warmupMaxRecipientsPerBroadcast: 10,
  warmupMaxPerDay: 20,
} as const;

export interface BroadcastLimitsOverride {
  maxRecipientsPerBroadcast: number;
  maxPerDay: number;
}

/** Limites de messages groupés réellement appliquées : réduites pendant warmupWindowDays après la toute première connexion d'un numéro (voir BROADCAST_LIMITS), normales ensuite. */
export function effectiveBroadcastLimits(accountCreatedAt: Date | null, now: Date): BroadcastLimitsOverride {
  if (!accountCreatedAt) return BROADCAST_LIMITS;
  const ageMs = now.getTime() - accountCreatedAt.getTime();
  if (ageMs < BROADCAST_LIMITS.warmupWindowDays * 24 * 3600_000) {
    return { maxRecipientsPerBroadcast: BROADCAST_LIMITS.warmupMaxRecipientsPerBroadcast, maxPerDay: BROADCAST_LIMITS.warmupMaxPerDay };
  }
  return BROADCAST_LIMITS;
}

/** Les envois groupés restent en pause le temps que la connexion WhatsApp se stabilise après une reconnexion. */
export function isReconnectCooldownActive(lastConnectedAt: Date | null, now: Date): boolean {
  if (!lastConnectedAt) return false;
  return now.getTime() - lastConnectedAt.getTime() < BROADCAST_LIMITS.reconnectCooldownMs;
}

/**
 * Mention de désinscription ajoutée à chaque message groupé. Plusieurs formulations équivalentes, tirées au hasard :
 * la même phrase envoyée mot pour mot à des dizaines de numéros est un motif connu de détection de masse.
 * Toutes se terminent par « répondez STOP. » : le mot reconnu par l'opt-out (voir ai/opt-out.ts) reste identique.
 */
export const OPT_OUT_FOOTERS = [
  "Pour ne plus recevoir nos messages, répondez STOP.",
  "Si vous ne souhaitez plus recevoir nos messages, répondez STOP.",
  "Vous pouvez arrêter ces messages à tout moment : répondez STOP.",
  "Pour vous désinscrire de nos messages, répondez STOP.",
  "Pour ne plus rien recevoir de notre part, répondez STOP.",
] as const;

/** Formulation historique, conservée pour les textes déjà enregistrés et les tests. */
export const OPT_OUT_FOOTER = `\n\n${OPT_OUT_FOOTERS[0]}`;

export function pickOptOutFooter(random: () => number = Math.random): string {
  return OPT_OUT_FOOTERS[Math.min(OPT_OUT_FOOTERS.length - 1, Math.floor(random() * OPT_OUT_FOOTERS.length))]!;
}

export function withOptOutFooter(text: string, random: () => number = Math.random): string {
  return `${text.trim()}\n\n${pickOptOutFooter(random)}`;
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
export function planBroadcastBatch(
  input: { eligible: number; sentLast24h: number; pendingNow: number },
  limits: BroadcastLimitsOverride = BROADCAST_LIMITS,
): BatchPlan {
  const { maxRecipientsPerBroadcast, maxPerDay } = limits;
  const remainingToday = Math.max(0, maxPerDay - input.sentLast24h - input.pendingNow);
  if (input.eligible < 1) return { ok: false, batchSize: 0, remaining: 0, remainingToday, reason: "Aucun client à contacter avec ces critères." };
  if (remainingToday < 1) {
    return { ok: false, batchSize: 0, remaining: input.eligible, remainingToday, reason: `Limite de ${maxPerDay} messages groupés par 24 h atteinte pour protéger votre numéro WhatsApp. Réessayez plus tard : les clients restants pourront alors recevoir le message.` };
  }
  const batchSize = Math.min(input.eligible, maxRecipientsPerBroadcast, remainingToday);
  return { ok: true, batchSize, remaining: input.eligible - batchSize, remainingToday };
}
