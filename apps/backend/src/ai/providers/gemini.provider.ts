import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import type { AIProvider, AIRawResult, AIRequestInput } from "../ai.types.js";

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor() {
    this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  async generateResponse(input: AIRequestInput): Promise<AIRawResult> {
    const start = Date.now();

    const contents = input.history.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    const response = await this.client.models.generateContent({
      model: env.GEMINI_MODEL,
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
}
