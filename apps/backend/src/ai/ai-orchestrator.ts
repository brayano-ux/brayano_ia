import { env } from "../config/env.js";
import { logAiRun } from "./ai-runs.service.js";
import type { AIAudioInput, AIChatMessage, AIProvider } from "./ai.types.js";
import { aiReplySchema, type AIReply } from "./schemas.js";

/**
 * Résultat toujours exploitable même en cas d'échec : si le LLM répond
 * n'importe quoi, on ne plante jamais le flux WhatsApp — on bascule sur
 * une réponse de repli et needsHuman = true.
 */
const FALLBACK_REPLY: AIReply = {
  reply:
    "Merci pour votre message. Un conseiller humain va prendre le relais pour vous répondre au mieux.",
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

    await logAiRun({
      conversationId,
      provider: providerName,
      model: providerName === "gemini" ? env.GEMINI_MODEL : providerName === "openrouter" ? env.OPENROUTER_MODEL : env.MISTRAL_MODEL,
      latencyMs,
      rawResponse: rawText,
      isValid: parsed !== null,
    });

    return parsed ?? FALLBACK_REPLY;
  }

  async transcribeAudio(input: AIAudioInput): Promise<string> {
    return this.provider.transcribeAudio(input);
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
      console.error("❌ Réponse IA invalide (JSON malformé) :", rawText);
      return null;
    }
  }
}
