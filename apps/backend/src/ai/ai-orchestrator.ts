import { env } from "../config/env.js";
import { logAiRun } from "./ai-runs.service.js";
import type { AIChatMessage, AIProvider } from "./ai.types.js";
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
  leadData: {},
};

export class AiOrchestrator {
  constructor(private readonly provider: AIProvider) {}

  async getReply(
    conversationId: string,
    systemPrompt: string,
    history: AIChatMessage[],
  ): Promise<AIReply> {
    let rawText = "";
    let latencyMs = 0;

    try {
      const result = await this.provider.generateResponse({ systemPrompt, history });
      rawText = result.rawText;
      latencyMs = result.latencyMs;
    } catch (error) {
      console.error("❌ Échec d'appel au fournisseur IA :", error);
      await logAiRun({
        conversationId,
        provider: this.provider.name,
        model: env.GEMINI_MODEL,
        latencyMs: 0,
        rawResponse: String(error),
        isValid: false,
      });
      return FALLBACK_REPLY;
    }

    const parsed = this.parseAndValidate(rawText);

    await logAiRun({
      conversationId,
      provider: this.provider.name,
      model: env.GEMINI_MODEL,
      latencyMs,
      rawResponse: rawText,
      isValid: parsed !== null,
    });

    return parsed ?? FALLBACK_REPLY;
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
