/**
 * Message d'accueil : envoyé une seule fois, au tout premier échange avec un contact
 * (aucun message sortant dans la conversation).
 */

const GREETING_WORDS = [
  "bonjour", "bonsoir", "bonne journee", "bonne soiree", "salut", "slt", "bjr", "bsr", "coucou", "cc", "hello", "hi", "hey",
  "hallo", "yo", "salam", "salamalecum", "assalamu alaykum", "good morning", "good evening", "good afternoon", "bonjour a tous",
  "how you dey", "how are you", "comment allez vous", "ca va", "cava", "bonsoir madame", "bonjour madame", "bonjour monsieur",
  "bonsoir monsieur", "hello sir", "hello madam", "bonjour svp", "bonsoir svp", "allo", "allô", "alo", "kikoo",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Vrai pour un simple « bonjour », « salut ça va ? », « hello »… : le message d'accueil y répond à lui seul. */
export function isPureGreeting(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized || normalized.length > 40) return false;
  const withoutGreetings = GREETING_WORDS
    .map(normalize)
    .sort((a, b) => b.length - a.length)
    .reduce((rest, word) => rest.replace(new RegExp(`(^|\\s)${word}(?=\\s|$)`, "g"), " "), normalized)
    .replace(/\b(a|tous|svp|stp|s il vous plait|monsieur|madame|sir|madam|mon|ma|cher|chere|les|amis|team|equipe)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return withoutGreetings === "";
}

export interface WelcomeDecision {
  /** Texte d'accueil à envoyer avant tout, ou null. */
  welcome: string | null;
  /** Le message d'accueil suffit : on n'appelle pas l'IA pour ce message. */
  welcomeOnly: boolean;
}

export function decideWelcome(input: { welcomeMessage: string | null | undefined; outboundCount: number; inboundText: string }): WelcomeDecision {
  const welcome = input.welcomeMessage?.trim() || null;
  if (!welcome || input.outboundCount > 0) return { welcome: null, welcomeOnly: false };
  return { welcome, welcomeOnly: isPureGreeting(input.inboundText) };
}

/** Consigne ajoutée au prompt quand l'accueil vient d'être envoyé juste avant la réponse. */
export const WELCOME_ALREADY_SENT_INSTRUCTION = `
MESSAGE D'ACCUEIL DÉJÀ ENVOYÉ

Le message d'accueil de l'entreprise vient d'être envoyé au client, juste avant ta réponse.
Ne le répète pas, ne te présente pas et ne salue pas à nouveau : réponds directement à sa demande.
`.trim();

/**
 * Le message d'accueil est enregistré avant d'appeler l'IA : dans l'historique il arrive donc APRÈS le message du client.
 * Pour que le modèle réponde bien au client, on remet l'accueil devant les messages du client (la conversation se lit
 * alors « accueil, puis question du client », et le dernier tour est celui du client).
 */
export function placeWelcomeBeforeClientMessages<T extends { role: "user" | "assistant"; content: string }>(history: T[], welcomeText: string): T[] {
  const last = history[history.length - 1];
  if (!last || last.role !== "assistant" || last.content !== welcomeText) return history;
  const rest = history.slice(0, -1);
  let firstClientTurn = rest.length;
  while (firstClientTurn > 0 && rest[firstClientTurn - 1]!.role === "user") firstClientTurn -= 1;
  return [...rest.slice(0, firstClientTurn), last, ...rest.slice(firstClientTurn)];
}
