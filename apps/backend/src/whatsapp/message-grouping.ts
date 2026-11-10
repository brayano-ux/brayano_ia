/**
 * Regroupement des messages envoyés à la suite. Sur WhatsApp, un client écrit souvent « Bonjour », puis « vous avez
 * des chaussures ? », puis « en 42 » en quelques secondes. Répondre à chacun séparément donne des réponses qui se
 * répètent ou se contredisent, et consomme un message du forfait à chaque fois. On attend donc un court instant
 * après chaque message : seul le DERNIER message d'une rafale déclenche une réponse, qui porte sur tout le groupe.
 *
 * L'état vit en mémoire (comme les verrous de conversation) : le serveur est une instance unique par numéro WhatsApp.
 */

/** Silence attendu après un message avant de répondre. Compris dans le délai de réponse configuré (5 s par défaut). */
export const MESSAGE_GROUPING_WINDOW_MS = 4_000;
/** Au-delà, un message resté sans réponse (assistant en pause, forfait épuisé…) n'est plus rattaché au groupe suivant. */
const PENDING_MAX_AGE_MS = 15 * 60_000;
const PENDING_MAX_MESSAGES = 10;

export interface PendingInbound {
  externalId: string;
  /** Texte du message tel qu'il est enregistré (transcription d'un vocal, légende d'un fichier…). */
  text: string;
  /** Texte où chercher une demande explicite (photo, localisation) : la légende pour un fichier reçu. */
  requestText: string;
  quotedMessageId?: string | undefined;
  hasMedia: boolean;
  receivedAt: number;
}

const pendingByConversation = new Map<string, PendingInbound[]>();
const latestByConversation = new Map<string, string>();
const welcomeCarriedOver = new Map<string, string>();

/** Enregistre un message en attente de réponse : il devient le plus récent de sa conversation. */
export function registerPendingInbound(conversationId: string, entry: Omit<PendingInbound, "receivedAt">, now = Date.now()) {
  const fresh = (pendingByConversation.get(conversationId) ?? []).filter((item) => now - item.receivedAt < PENDING_MAX_AGE_MS && item.externalId !== entry.externalId);
  fresh.push({ ...entry, receivedAt: now });
  pendingByConversation.set(conversationId, fresh.slice(-PENDING_MAX_MESSAGES));
  latestByConversation.set(conversationId, entry.externalId);
}

/** Faux dès qu'un message plus récent est arrivé dans la conversation : c'est lui qui portera la réponse au groupe. */
export function isLatestInbound(conversationId: string, externalId: string): boolean {
  return latestByConversation.get(conversationId) === externalId;
}

/** Messages du client encore sans réponse, du plus ancien au plus récent. */
export function pendingGroup(conversationId: string, now = Date.now()): PendingInbound[] {
  return (pendingByConversation.get(conversationId) ?? []).filter((item) => now - item.receivedAt < PENDING_MAX_AGE_MS);
}

/** À appeler quand le groupe a été traité (réponse envoyée, ou décision de ne pas répondre). */
export function clearPendingGroup(conversationId: string, externalIds: string[]) {
  const remaining = (pendingByConversation.get(conversationId) ?? []).filter((item) => !externalIds.includes(item.externalId));
  if (remaining.length) {
    pendingByConversation.set(conversationId, remaining);
    return;
  }
  pendingByConversation.delete(conversationId);
  const latest = latestByConversation.get(conversationId);
  if (latest && externalIds.includes(latest)) latestByConversation.delete(conversationId);
}

/**
 * Le message d'accueil est parti, puis la réponse a été abandonnée au profit d'un message plus récent : la réponse
 * suivante doit savoir que l'accueil vient d'être envoyé, pour ne pas saluer une seconde fois.
 */
export function carryWelcomeOver(conversationId: string, welcomeText: string) {
  welcomeCarriedOver.set(conversationId, welcomeText);
}

export function takeCarriedWelcome(conversationId: string): string | null {
  const welcome = welcomeCarriedOver.get(conversationId) ?? null;
  welcomeCarriedOver.delete(conversationId);
  return welcome;
}

/** Consigne ajoutée au prompt quand la réponse porte sur plusieurs messages envoyés d'affilée. */
export function buildGroupedMessagesSection(count: number): string | null {
  if (count < 2) return null;
  return `
MESSAGES ENVOYÉS À LA SUITE

Le client vient d'envoyer ${count} messages d'affilée : ce sont les ${count} derniers messages de la conversation.
Lis-les comme un seul message et réponds à l'ensemble en UNE seule réponse, sans répondre séparément à chacun
et sans te répéter. Si un message complète ou corrige le précédent, c'est le plus récent qui compte.
`.trim();
}

/** Réservé aux tests : oublie tous les messages en attente. */
export function resetMessageGroupingForTests() {
  pendingByConversation.clear();
  latestByConversation.clear();
  welcomeCarriedOver.clear();
}
