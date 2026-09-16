import { env } from "../../config/env.js";
import type { AIAudioInput, AIProvider, AIRawResult, AIRequestInput } from "../ai.types.js";

export class MistralProvider implements AIProvider {
  readonly name = "mistral";

  async generateResponse(input: AIRequestInput): Promise<AIRawResult> {
    const start = Date.now();

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.MISTRAL_MODEL,
        messages: [
          { role: "system", content: input.systemPrompt },
          ...input.history.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral API error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const rawText = payload.choices?.[0]?.message?.content ?? "";

    return {
      rawText,
      latencyMs: Date.now() - start,
    };
  }

  async transcribeAudio(input: AIAudioInput): Promise<string> {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.MISTRAL_MODEL,
        messages: [
          {
            role: "user",
            content: `Transcris fidèlement cet audio en français. Retourne uniquement le texte transcrit, sans commentaire ni formatage.\n\n[Audio binaire attaché]`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral transcription error (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return payload.choices?.[0]?.message?.content?.trim() ?? "";
  }
}
