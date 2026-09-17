import { env } from "../../config/env.js";
import type { AIAudioInput, AIProvider, AIRawResult, AIRequestInput } from "../ai.types.js";

export class OpenRouterProvider implements AIProvider {
  readonly name = "openrouter";

  async generateResponse(input: AIRequestInput): Promise<AIRawResult> {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY est requis pour utiliser le provider OpenRouter.");
    }

    const start = Date.now();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": env.APP_URL,
        "X-Title": "Brayano AI",
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        messages: [
          { role: "system", content: input.systemPrompt },
          ...input.history.map((message) => ({ role: message.role, content: message.content })),
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    return {
      rawText: payload.choices?.[0]?.message?.content ?? "",
      latencyMs: Date.now() - start,
    };
  }

  async transcribeAudio(_input: AIAudioInput): Promise<string> {
    throw new Error("La transcription audio OpenRouter n'est pas configurée.");
  }
}