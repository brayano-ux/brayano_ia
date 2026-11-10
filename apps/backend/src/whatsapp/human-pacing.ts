/**
 * Rythme « humain » des réponses de l'assistant. WhatsApp restreint les numéros dont l'activité ressemble à un
 * automate : réponse à la seconde près, frappe de trois secondes pour un paragraphe, pavé unique… Ce module
 * calcule des durées plausibles (toujours avec une part d'aléatoire) et découpe les longues réponses en
 * quelques bulles, comme le ferait une personne qui écrit depuis son téléphone.
 *
 * Tout est pur et injectable (`random`, `wait`) : les tests ne patientent jamais réellement.
 */

import type { WhatsAppProvider } from "./whatsapp.types.js";

/** ±20 % autour du délai configuré : un humain ne répond jamais exactement à la même seconde près à chaque fois. */
export function jitteredDelayMs(delaySeconds: number, random: () => number): number {
  const factor = 0.8 + random() * 0.4;
  return delaySeconds * 1000 * factor;
}

export const TYPING = {
  /** Temps de lecture et de mise en route avant de taper. */
  baseMs: 1_200,
  /** Rythme de frappe simulé (environ 30 caractères par seconde : une personne rapide, qui connaît ses produits). */
  perCharMs: 32,
  /** Au-delà, la frappe ne s'allonge plus : un commerçant copie-colle ou abrège, il ne tape pas deux minutes. */
  maxMs: 14_000,
  /** Intervalle de rafraîchissement de « en train d'écrire… » (WhatsApp l'efface tout seul après une dizaine de secondes). */
  keepAliveMs: 7_000,
} as const;

/** Durée de frappe plausible pour ce texte, avec ±20 % d'aléatoire. */
export function typingDurationMs(text: string, random: () => number): number {
  const raw = Math.min(TYPING.maxMs, TYPING.baseMs + text.length * TYPING.perCharMs);
  return raw * (0.8 + random() * 0.4);
}

/** Jamais d'envoi « sec » : le client voit toujours l'agent écrire au moins ce temps-là avant de recevoir la réponse. */
export const MIN_VISIBLE_TYPING_MS = 1_500;
/**
 * Jusqu'à ce délai configuré, l'agent « écrit » dès qu'il a lu le message, pendant que l'IA prépare la réponse.
 * Au-delà (1 ou 2 minutes), il lit, laisse passer le délai en silence, puis écrit juste avant d'envoyer : personne
 * ne reste deux minutes « en train d'écrire ».
 */
export const EARLY_TYPING_MAX_DELAY_SECONDS = 10;

export interface ReplyPacingPlan {
  /** Attente sans rien afficher (délais longs uniquement). */
  silentMs: number;
  /** Attente avec « en train d'écrire… » affiché, juste avant l'envoi. */
  typingMs: number;
}

/**
 * Ce qu'il reste à attendre une fois la réponse prête. Deux règles :
 *  - le délai configuré par le propriétaire (avec aléatoire) est compté depuis la réception du message ;
 *  - le temps de frappe plausible pour ce texte est compté depuis l'instant où « en train d'écrire… » s'est affiché,
 *    donc le temps que l'IA a mis à répondre compte comme de la frappe quand l'indicateur était déjà visible.
 * Une IA lente n'ajoute ainsi plus d'attente, et une IA rapide ne provoque jamais un envoi sans frappe visible.
 */
export function planReplyPacing(
  input: { configuredDelaySeconds: number; replyText: string; elapsedMs: number; typingVisibleMs: number },
  random: () => number,
): ReplyPacingPlan {
  const typingTarget = Math.max(typingDurationMs(input.replyText, random), MIN_VISIBLE_TYPING_MS);
  const typingLeft = Math.max(0, typingTarget - input.typingVisibleMs);
  const delayLeft = Math.max(0, jitteredDelayMs(input.configuredDelaySeconds, random) - input.elapsedMs);
  // Indicateur déjà affiché : l'agent continue d'écrire jusqu'à l'envoi, sans trou.
  if (input.typingVisibleMs > 0) return { silentMs: 0, typingMs: Math.max(typingLeft, delayLeft) };
  return { silentMs: Math.max(0, delayLeft - typingLeft), typingMs: typingLeft };
}

export interface TypingSession {
  /** Affiche « en train d'écrire… » et le maintient. Sans effet si c'est déjà fait. */
  start(): void;
  /** Depuis combien de temps l'indicateur est visible (0 s'il n'a pas été affiché). */
  visibleMs(): number;
  /** Arrête de rafraîchir l'indicateur. À appeler dans tous les cas (réponse envoyée ou non). */
  stop(): void;
}

/**
 * « En train d'écrire… » maintenu pendant une durée inconnue à l'avance (l'appel à l'IA) : WhatsApp efface
 * l'indicateur au bout d'une dizaine de secondes, il est donc renvoyé régulièrement jusqu'à `stop()`.
 * `keepAlive: false` (tests) : l'indicateur est envoyé une seule fois, sans minuterie.
 */
export function createTypingSession(
  instance: Pick<WhatsAppProvider, "sendTypingIndicator">,
  jid: string,
  options: { keepAlive?: boolean; now?: () => number } = {},
): TypingSession {
  const now = options.now ?? Date.now;
  const send = () => void instance.sendTypingIndicator?.(jid).catch(() => undefined);
  let startedAt: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    start() {
      if (startedAt !== null) return;
      startedAt = now();
      send();
      if (options.keepAlive !== false) {
        timer = setInterval(send, TYPING.keepAliveMs);
        timer.unref?.();
      }
    },
    visibleMs() {
      return startedAt === null ? 0 : Math.max(1, now() - startedAt);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

/**
 * Affiche « en train d'écrire… » pendant `totalMs`, en rafraîchissant l'indicateur régulièrement (sinon WhatsApp le
 * retire au bout de quelques secondes et la fin de l'attente redevient un silence suspect). Avec `wait` injecté
 * (tests), l'indicateur est envoyé une seule fois et l'attente est déléguée.
 */
export async function waitWhileTyping(
  totalMs: number,
  instance: Pick<WhatsAppProvider, "sendTypingIndicator">,
  jid: string,
  wait?: (ms: number) => Promise<void>,
): Promise<void> {
  if (totalMs <= 0) return;
  void instance.sendTypingIndicator?.(jid).catch(() => undefined);
  if (wait) {
    await wait(totalMs);
    return;
  }
  let remaining = totalMs;
  while (remaining > 0) {
    const slice = Math.min(remaining, TYPING.keepAliveMs);
    await new Promise((resolve) => setTimeout(resolve, slice));
    remaining -= slice;
    if (remaining > 0) void instance.sendTypingIndicator?.(jid).catch(() => undefined);
  }
}

export const BUBBLES = {
  /** En dessous, le texte part d'un seul bloc. */
  minLengthToSplit: 240,
  /** Jamais plus de bulles que ça : au-delà, on gêne le client au lieu de paraître naturel. */
  max: 3,
  /** Une bulle plus courte que ça est recollée à sa voisine (un « Bonjour ! » seul, un « Bonne journée. »). */
  minBubbleLength: 40,
  /** Pause entre deux bulles : lecture de ce qu'on vient d'envoyer, puis frappe de la suivante. */
  pauseBaseMs: 700,
  pausePerCharMs: 18,
  pauseMaxMs: 3_500,
} as const;

/** Phrases d'un paragraphe : coupure après « . ! ? … » suivi d'un espace et d'une majuscule, d'un chiffre ou d'un guillemet. */
function splitSentences(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"(])/u).map((part) => part.trim()).filter(Boolean);
}

/** Regroupe des morceaux dans l'ordre en `parts` groupes de longueurs voisines. */
function groupBalanced(pieces: string[], parts: number, separator: string): string[] {
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const target = total / parts;
  const groups: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;
  for (const piece of pieces) {
    const remainingGroups = parts - groups.length;
    const remainingPieces = pieces.length - pieces.indexOf(piece);
    if (current.length && currentLength >= target && remainingGroups > 1 && remainingPieces >= remainingGroups - 1) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(piece);
    currentLength += piece.length;
  }
  if (current.length) groups.push(current);
  return groups.map((group) => group.join(separator));
}

/** Recolle les bulles trop courtes à la précédente (ou à la suivante pour la première). */
function mergeShortBubbles(bubbles: string[], separator: string): string[] {
  const result: string[] = [];
  for (const bubble of bubbles) {
    const previous = result[result.length - 1];
    if (previous !== undefined && (bubble.length < BUBBLES.minBubbleLength || previous.length < BUBBLES.minBubbleLength)) {
      result[result.length - 1] = `${previous}${separator}${bubble}`;
    } else {
      result.push(bubble);
    }
  }
  return result;
}

/**
 * Découpe une réponse en 1 à 3 bulles. Les paragraphes (lignes vides) sont la coupure naturelle ; un paragraphe
 * unique est coupé entre ses phrases. Un paragraphe sur plusieurs lignes (liste, horaires, adresse) n'est jamais
 * coupé à l'intérieur. Le texte reconstitué est identique à l'original, aux espaces de séparation près.
 */
export function splitIntoBubbles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length < BUBBLES.minLengthToSplit) return [trimmed];

  const paragraphs = trimmed.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length >= 2) {
    const parts = Math.min(BUBBLES.max, paragraphs.length);
    return mergeShortBubbles(groupBalanced(paragraphs, parts, "\n\n"), "\n\n");
  }

  const paragraph = paragraphs[0] ?? trimmed;
  if (paragraph.includes("\n")) return [paragraph];
  const sentences = splitSentences(paragraph);
  if (sentences.length < 2) return [paragraph];
  const parts = Math.min(BUBBLES.max, paragraph.length >= 2 * BUBBLES.minLengthToSplit ? 3 : 2, sentences.length);
  return mergeShortBubbles(groupBalanced(sentences, parts, " "), " ");
}

/** Pause avant d'envoyer la bulle `next` (après la précédente), avec ±20 % d'aléatoire. */
export function bubblePauseMs(next: string, random: () => number): number {
  const raw = Math.min(BUBBLES.pauseMaxMs, BUBBLES.pauseBaseMs + next.length * BUBBLES.pausePerCharMs);
  return raw * (0.8 + random() * 0.4);
}

/**
 * Envoie un texte en une ou plusieurs bulles, avec « en train d'écrire… » et une pause entre deux. Renvoie le nombre
 * de bulles envoyées. Si une bulle échoue après la première, l'erreur remonte : l'appelant décide (le texte déjà
 * parti reste chez le client, comme un message humain interrompu).
 */
export async function sendInBubbles(
  instance: Pick<WhatsAppProvider, "sendMessage" | "sendTypingIndicator">,
  jid: string,
  text: string,
  options: { wait?: ((ms: number) => Promise<void>) | undefined; random?: () => number } = {},
): Promise<number> {
  const random = options.random ?? Math.random;
  const bubbles = splitIntoBubbles(text);
  for (const [index, bubble] of bubbles.entries()) {
    if (index > 0) await waitWhileTyping(bubblePauseMs(bubble, random), instance, jid, options.wait);
    await instance.sendMessage(jid, bubble);
  }
  return bubbles.length;
}
