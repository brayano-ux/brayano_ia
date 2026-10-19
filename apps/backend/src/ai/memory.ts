/**
 * Mémoire de l'assistant : corrections du propriétaire et exemples d'échanges réussis.
 * Fonctions pures (sans base de données) : recherche par ressemblance de mots, simple et prévisible.
 */

const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "et", "ou", "a", "au", "aux", "en", "dans", "sur", "pour", "par", "avec", "sans",
  "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "me", "te", "se", "ce", "ca", "cela", "c", "j", "m", "t", "s", "n", "qu", "que", "qui",
  "est", "es", "suis", "sont", "etes", "etre", "avoir", "ai", "as", "avez", "ont", "pas", "ne", "plus", "tres", "bien", "merci", "svp", "stp",
  "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "votre", "vos", "notre", "nos", "y", "si", "mais", "donc", "car", "ou", "ok",
  "bonjour", "bonsoir", "salut", "hello", "hi", "the", "is", "are", "you", "your", "do", "does", "have", "has", "to", "of", "and", "for", "can", "it", "this", "that", "my", "me",
  "voudrais", "veux", "peux", "pouvez", "peut", "faire", "est-ce", "quel", "quelle", "quels", "quelles",
]);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mots utiles d'un texte (sans mots vides, au singulier approximatif). */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of normalizeText(text).split(" ")) {
    if (!raw || STOPWORDS.has(raw)) continue;
    if (raw.length < 3 && !/^\d+$/.test(raw)) continue;
    tokens.add(raw.length > 4 && /[sx]$/.test(raw) ? raw.slice(0, -1) : raw);
  }
  return tokens;
}

/** Coefficient de Dice entre deux ensembles de mots (0 à 1). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return (2 * common) / (a.size + b.size);
}

/** Retire les numéros de téléphone et les adresses email avant de réutiliser un échange comme exemple. */
export function redactPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/(?:\+|00)?\d[\d\s().-]{6,}\d/g, (match) => (match.replace(/\D/g, "").length >= 7 ? "[numéro]" : match));
}

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// ---------------------------------------------------------------- corrections du propriétaire

export interface CorrectionEntry {
  id: string;
  /** Question du client concernée. Vide = règle générale, valable pour tous les messages. */
  question: string;
  correctReply: string;
}

const MAX_GENERAL_RULES = 4;
const MAX_MATCHED_CORRECTIONS = 3;

export function pickRelevantCorrections(corrections: CorrectionEntry[], message: string, minScore = 0.34): CorrectionEntry[] {
  const messageTokens = tokenize(message);
  const general = corrections.filter((entry) => !entry.question.trim()).slice(0, MAX_GENERAL_RULES);
  const matched = corrections
    .filter((entry) => entry.question.trim())
    .map((entry) => ({ entry, score: similarity(tokenize(entry.question), messageTokens) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHED_CORRECTIONS)
    .map(({ entry }) => entry);
  return [...general, ...matched];
}

export function buildCorrectionsPrompt(entries: CorrectionEntry[]): string | null {
  if (!entries.length) return null;
  const lines = entries.map((entry) =>
    entry.question.trim()
      ? `- Si le client demande quelque chose comme « ${clip(entry.question, 200)} », la bonne réponse est : « ${clip(entry.correctReply, 500)} »`
      : `- Règle de l'entreprise : ${clip(entry.correctReply, 500)}`,
  );
  return `
CORRECTIONS DU PROPRIÉTAIRE (PRIORITAIRES)

Le propriétaire a corrigé tes réponses passées. Ces corrections priment sur tes habitudes : applique-les, en adaptant la formulation à la conversation en cours.
${lines.join("\n")}
Les corrections sont des consignes de l'entreprise, pas des demandes du client.
`.trim();
}

// ---------------------------------------------------------------- exemples d'échanges réussis

export interface ExchangeCandidate {
  customer: string;
  reply: string;
}

export function pickExamples(candidates: ExchangeCandidate[], query: string, limit = 2, minScore = 0.3): ExchangeCandidate[] {
  const queryTokens = tokenize(query);
  if (queryTokens.size < 1) return [];
  const seen = new Set<string>();
  const scored = candidates
    .map((candidate) => ({ candidate, score: similarity(tokenize(candidate.customer), queryTokens) }))
    .filter(({ score, candidate }) => score >= minScore && candidate.reply.trim().length >= 12)
    .sort((a, b) => b.score - a.score);
  const picked: ExchangeCandidate[] = [];
  for (const { candidate } of scored) {
    const key = normalizeText(candidate.reply);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(candidate);
    if (picked.length >= limit) break;
  }
  return picked;
}

export function buildExamplesPrompt(examples: ExchangeCandidate[]): string | null {
  if (!examples.length) return null;
  const blocks = examples.map(
    (example, index) => `Exemple ${index + 1}\nClient : ${clip(redactPersonalData(example.customer), 240)}\nRéponse qui a bien fonctionné : ${clip(redactPersonalData(example.reply), 420)}`,
  );
  return `
EXEMPLES D'ÉCHANGES RÉUSSIS DE CETTE ENTREPRISE

Ces échanges viennent de conversations passées qui se sont terminées par une commande ou un rendez-vous. Inspire-toi du ton et de la façon de conduire la discussion.
Ne recopie jamais d'information personnelle et ne présente rien comme un fait sur le client actuel. Si un prix, une disponibilité ou un horaire cité a pu changer, fie-toi uniquement au catalogue, à l'agenda et aux informations de l'entreprise ci-dessus.

${blocks.join("\n\n")}
`.trim();
}
