import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import type { AIAudioInput, AIProvider, AIRawResult, AIRequestInput } from "../ai.types.js";

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor() {
    if (!env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY est requis pour utiliser le provider Gemini.");
    }

    this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  async generateResponse(input: AIRequestInput): Promise<AIRawResult> {
    const start = Date.now();

    const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";

    const contents = input.history.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    const response = await this.client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: input.systemPrompt,
        responseMimeType: "application/json",
      },
    });

    return {
      rawText: response.text ?? "",
      latencyMs: Date.now() - start,
    };
  }

  async transcribeAudio(input: AIAudioInput): Promise<string> {
    const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";

    const response = await this.client.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { data: input.data.toString("base64"), mimeType: input.mimeType } },
          { text: "Transcris fidèlement cet audio en français. Retourne uniquement le texte transcrit, sans commentaire ni formatage." },
        ],
      }],
    });

    return response.text?.trim() ?? "";
  }
}
