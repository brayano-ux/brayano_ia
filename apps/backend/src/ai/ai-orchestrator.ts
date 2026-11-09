import { env } from "../config/env.js";
import { logAiRun } from "./ai-runs.service.js";
import type { AIAudioInput, AIChatMessage, AIMediaInput, AIProvider } from "./ai.types.js";
import { parseMediaAnalysis, type MediaAnalysis } from "./media-analysis.js";
import { aiReplySchema, type AIReply } from "./schemas.js";

/**
 * Résultat toujours exploitable même en cas d'échec : si aucun fournisseur ne répond correctement, on ne plante
 * jamais le flux WhatsApp. La réponse de repli porte l'intention `erreur_traitement` et n'est PAS un passage de
 * main : une panne passagère de l'IA ne doit pas couper l'assistant pour ce client (voir
 * whatsapp/incoming-message.ts, qui décide quoi envoyer dans ce cas et prévient le propriétaire).
 */
export const FALLBACK_REPLY: AIReply = {
  reply: "Un instant, je vérifie et je reviens vers vous 🙏",
  intent: "erreur_traitement",
  confidence: 0,
  needsHuman: false,
  leadScore: 0,
  qualificationStatus: "qualifying",
  nextAction: "continue",
  leadData: {},
};

export const AI_TIMEOUTS = {
  /** Délai maximal d'une génération : au-delà, on passe au fournisseur suivant (la requête abandonnée est ignorée). */
  replyMs: 45_000,
  /** Attente avant la seconde tentative sur une erreur passagère (quota, serveur indisponible). */
  retryDelayMs: 1_500,
  transcriptionMs: 60_000,
  mediaMs: 25_000,
} as const;

/**
 * Erreurs qui valent une seconde tentative sur le même fournisseur : quota dépassé (429), serveur en difficulté
 * (5xx), coupure réseau. Une clé invalide (401/403) ou un modèle inconnu (404) ne se répareront pas en réessayant.
 */
export function isRetryableError(error: unknown): boolean {
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : null;
  if (status !== null) return status === 429 || status === 408 || status >= 500;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|408|5\d\d)\b|rate limit|quota|overloaded|resource exhausted|unavailable|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(message);
}

/**
 * Extrait l'objet JSON d'un texte de modèle : certains entourent la réponse de ```json … ```, d'une phrase
 * d'introduction ou d'un commentaire final. On garde ce qui va de la première accolade à la dernière.
 */
export function extractJsonObject(rawText: string): string {
  let text = rawText.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);
  return text;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : délai de ${Math.round(ms / 1000)} s dépassé.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function modelNameFor(provider: AIProvider): string {
  if (provider.model) return provider.model;
  if (provider.name === "gemini") return env.GEMINI_MODEL;
  if (provider.name === "openrouter") return env.OPENROUTER_MODEL;
  if (provider.name === "mistral") return env.MISTRAL_MODEL;
  return provider.name;
}

function label(provider: AIProvider): string {
  return provider.model ? `${provider.name} (${provider.model})` : provider.name;
}

export class AiOrchestrator {
  private readonly providers: AIProvider[];

  /**
   * `primary` puis tous les secours, dans l'ordre : chaque fournisseur est essayé (avec une seconde tentative sur
   * erreur passagère) avant de passer au suivant. Accepte aussi un tableau pour la lisibilité.
   */
  constructor(
    primary: AIProvider | AIProvider[],
    ...fallbacks: Array<AIProvider | undefined>
  ) {
    const list = Array.isArray(primary) ? primary : [primary, ...fallbacks];
    this.providers = list.filter((provider): provider is AIProvider => Boolean(provider));
    if (!this.providers.length) throw new Error("Aucun fournisseur IA configuré.");
  }

  /** Noms des fournisseurs, dans l'ordre d'essai (utile pour les journaux et les tests). */
  get providerNames(): string[] {
    return this.providers.map((provider) => provider.name);
  }

  async getReply(
    conversationId: string,
    systemPrompt: string,
    history: AIChatMessage[],
    options: { logRun?: boolean; wait?: (ms: number) => Promise<void> } = {},
  ): Promise<AIReply> {
    const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let rawText = "";
    let latencyMs = 0;
    let used: AIProvider = this.providers[0]!;
    let parsed: AIReply | null = null;
    const failures: string[] = [];

    for (const provider of this.providers) {
      for (let attempt = 1; attempt <= 2 && !parsed; attempt += 1) {
        try {
          const result = await withTimeout(provider.generateResponse({ systemPrompt, history }), AI_TIMEOUTS.replyMs, `Fournisseur ${label(provider)}`);
          rawText = result.rawText;
          latencyMs = result.latencyMs;
          used = provider;
          parsed = this.parseAndValidate(rawText);
          if (!parsed) {
            failures.push(`${label(provider)} : réponse invalide`);
            break; // Une réponse mal formée ne se corrige pas en renvoyant la même requête : fournisseur suivant.
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rawText = message;
          failures.push(`${label(provider)} (essai ${attempt}) : ${message.slice(0, 160)}`);
          if (attempt === 1 && isRetryableError(error)) {
            await wait(AI_TIMEOUTS.retryDelayMs);
            continue;
          }
          break;
        }
      }
      if (parsed) break;
    }

    if (!parsed) {
      console.error(`❌ Aucun fournisseur IA n'a répondu correctement :\n  - ${failures.join("\n  - ")}`);
    } else if (failures.length) {
      console.warn(`⚠️ Réponse obtenue avec ${label(used)} après : ${failures.join(" ; ")}`);
    }

    if (options.logRun !== false) {
      await logAiRun({
        conversationId,
        provider: used.name,
        model: modelNameFor(used),
        latencyMs,
        rawResponse: parsed ? rawText : `${rawText}\n\n[échecs : ${failures.join(" | ")}]`.slice(0, 20_000),
        isValid: parsed !== null,
      }).catch((error) => console.error("Journal IA non enregistré :", error));
    }

    return parsed ?? FALLBACK_REPLY;
  }

  async transcribeAudio(input: AIAudioInput): Promise<string> {
    for (const provider of this.providers) {
      try {
        const text = await withTimeout(provider.transcribeAudio(input), AI_TIMEOUTS.transcriptionMs, "Transcription audio");
        if (text.trim()) return text.trim();
        console.warn(`Transcription audio vide avec ${provider.name}.`);
      } catch {
        console.warn(`Transcription audio impossible avec ${provider.name}, essai du fournisseur suivant.`);
      }
    }
    throw new Error("Aucun fournisseur IA n’a pu transcrire le message vocal.");
  }

  /** Décrit une photo ou un document reçu. Renvoie null si aucun modèle ne sait le faire : l'appelant s'en passe. */
  async analyzeMedia(input: AIMediaInput): Promise<MediaAnalysis | null> {
    for (const provider of this.providers) {
      if (!provider.analyzeMedia) continue;
      try {
        const raw = await withTimeout(provider.analyzeMedia(input), AI_TIMEOUTS.mediaMs, "Analyse du fichier");
        const analysis = parseMediaAnalysis(raw);
        if (analysis) return analysis;
      } catch (error) {
        console.error(`❌ Analyse de fichier impossible avec ${provider.name} :`, error instanceof Error ? error.message : error);
      }
    }
    return null;
  }

  private parseAndValidate(rawText: string): AIReply | null {
    try {
      const json: unknown = JSON.parse(extractJsonObject(rawText));
      const result = aiReplySchema.safeParse(json);
      if (!result.success) {
        console.error("❌ Réponse IA invalide (schéma) :", result.error.flatten());
        return null;
      }
      return result.data;
    } catch {
      console.error(`❌ Réponse IA invalide (JSON malformé, ${rawText.length} caractères).`);
      return null;
    }
  }
}
