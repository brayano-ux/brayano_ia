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
      throw new Error(`OpenRouter API error (${response.status}): ${errorText.slice(0, 200).replace(/\s+/g, " ")}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    return {
      rawText: payload.choices?.[0]?.message?.content ?? "",
      latencyMs: Date.now() - start,
    };
  }

  async transcribeAudio(input: AIAudioInput): Promise<string> {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY est requis pour la transcription OpenRouter.");
    }
    const mimeType = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    const formats: Record<string, string> = {
      "audio/ogg": "ogg", "application/ogg": "ogg",
      "audio/mpeg": "mp3", "audio/mp3": "mp3",
      "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
      "audio/flac": "flac", "audio/x-flac": "flac",
      "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
      "audio/webm": "webm", "audio/aac": "aac", "audio/x-aac": "aac",
    };
    const format = formats[mimeType];
    if (!format) throw new Error("Format audio non pris en charge par la transcription OpenRouter.");
    if (!input.data.length || input.data.length > 25 * 1024 * 1024) {
      throw new Error("La transcription OpenRouter accepte un audio non vide de 25 Mo maximum.");
    }

    const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": env.APP_URL,
        "X-Title": "Brayano AI",
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: env.OPENROUTER_TRANSCRIPTION_MODEL,
        input_audio: { data: input.data.toString("base64"), format },
        response_format: "json",
        // Pas de langue imposée : français, anglais et autres langues restent détectés automatiquement.
      }),
    });
    if (!response.ok) {
      // Ne pas inclure le corps de la requête/réponse : il peut contenir l'audio ou sa transcription.
      throw new Error(`OpenRouter transcription error (${response.status}).`);
    }
    const payload: unknown = await response.json();
    const text = payload && typeof payload === "object" && "text" in payload ? payload.text : undefined;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("OpenRouter n’a renvoyé aucune transcription exploitable.");
    }
    return text.trim();
  }
}