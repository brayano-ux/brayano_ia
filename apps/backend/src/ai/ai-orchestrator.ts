import { env } from "../config/env.js";
import { logAiRun } from "./ai-runs.service.js";
import type { AIAudioInput, AIChatMessage, AIMediaInput, AIProvider } from "./ai.types.js";
import { parseMediaAnalysis, type MediaAnalysis } from "./media-analysis.js";
import { aiReplySchema, type AIReply } from "./schemas.js";

/**
 * Résultat toujours exploitable même en cas d'échec : si le LLM répond
 * n'importe quoi, on ne plante jamais le flux WhatsApp — on bascule sur
 * une réponse de repli et needsHuman = true.
 */
const FALLBACK_REPLY: AIReply = {
  reply:
    "Merci pour votre message.",
  intent: "erreur_traitement",
  confidence: 0,
  needsHuman: true,
  leadScore: 0,
  qualificationStatus: "qualifying",
  nextAction: "handoff",
  leadData: {},
};

export class AiOrchestrator {
  constructor(
    private readonly provider: AIProvider,
    private readonly fallbackProvider?: AIProvider,
  ) {}

  async getReply(
    conversationId: string,
    systemPrompt: string,
    history: AIChatMessage[],
    options: { logRun?: boolean } = {},
  ): Promise<AIReply> {
    let rawText = "";
    let latencyMs = 0;

    let parsed: AIReply | null = null;
    let providerName = this.provider.name;

    try {
      const result = await this.provider.generateResponse({ systemPrompt, history });
      rawText = result.rawText;
      latencyMs = result.latencyMs;
      parsed = this.parseAndValidate(rawText);
    } catch (error) {
      console.error(`❌ Échec du fournisseur IA principal (${this.provider.name}) :`, error);
      rawText = String(error);
    }

    if (!parsed && this.fallbackProvider) {
      try {
        const result = await this.fallbackProvider.generateResponse({ systemPrompt, history });
        rawText = result.rawText;
        latencyMs = result.latencyMs;
        parsed = this.parseAndValidate(rawText);
        providerName = this.fallbackProvider.name;
        console.warn(`⚠️ Réponse obtenue avec le fournisseur de secours (${providerName}).`);
      } catch (error) {
        console.error(`❌ Échec du fournisseur IA de secours (${this.fallbackProvider.name}) :`, error);
        rawText = String(error);
      }
    }

    if (options.logRun !== false) {
      await logAiRun({
        conversationId,
        provider: providerName,
        model: providerName === "gemini" ? env.GEMINI_MODEL : providerName === "openrouter" ? env.OPENROUTER_MODEL : env.MISTRAL_MODEL,
        latencyMs,
        rawResponse: rawText,
        isValid: parsed !== null,
      });
    }

    return parsed ?? FALLBACK_REPLY;
  }

  async transcribeAudio(input: AIAudioInput): Promise<string> {
    for (const provider of [this.provider, this.fallbackProvider]) {
      if (!provider) continue;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const text = await Promise.race([
          provider.transcribeAudio(input),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Transcription audio trop longue.")), 60_000);
          }),
        ]);
        if (text.trim()) return text.trim();
        console.warn(`Transcription audio vide avec ${provider.name}.`);
      } catch {
        console.warn(`Transcription audio impossible avec ${provider.name}, essai du fournisseur suivant.`);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    throw new Error("Aucun fournisseur IA n’a pu transcrire le message vocal.");
  }

  /** Décrit une photo ou un document reçu. Renvoie null si aucun modèle ne sait le faire : l'appelant s'en passe. */
  async analyzeMedia(input: AIMediaInput): Promise<MediaAnalysis | null> {
    for (const provider of [this.provider, this.fallbackProvider]) {
      if (!provider?.analyzeMedia) continue;
      try {
        const raw = await Promise.race([
          provider.analyzeMedia(input),
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Analyse du fichier trop longue.")), 25_000)),
        ]);
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
      const json: unknown = JSON.parse(rawText);
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
