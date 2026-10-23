import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({ OPENROUTER_API_KEY: "test-key" as string | undefined, OPENROUTER_MODEL: "text-only-model", OPENROUTER_TRANSCRIPTION_MODEL: "openai/whisper-1", APP_URL: "https://example.test" }));
vi.mock("../../config/env.js", () => ({ env: config }));
import { OpenRouterProvider } from "./openrouter.provider.js";
const audio = { data: Buffer.from("OggS-test-audio"), mimeType: "audio/ogg; codecs=opus" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => { config.OPENROUTER_API_KEY = "test-key"; config.OPENROUTER_TRANSCRIPTION_MODEL = "openai/whisper-1"; vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter speech-to-text", () => {
  it("sends a WhatsApp OGG/Opus vocal to the dedicated endpoint and preserves the transcript language", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ text: "  Abeg, how much be dis?  " }));
    expect(await new OpenRouterProvider().transcribeAudio(audio)).toBe("Abeg, how much be dis?");
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    const body = JSON.parse(options!.body as string);
    expect(body).toEqual({ model: "openai/whisper-1", input_audio: { data: audio.data.toString("base64"), format: "ogg" }, response_format: "json" });
    expect(options!.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(options!.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the separate configured transcription model", async () => {
    config.OPENROUTER_TRANSCRIPTION_MODEL = "openai/whisper-large-v3-turbo";
    vi.mocked(fetch).mockResolvedValue(response({ text: "Bonjour" }));
    await new OpenRouterProvider().transcribeAudio(audio);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).model).toBe("openai/whisper-large-v3-turbo");
  });

  it.each([["audio/mpeg", "mp3"], ["audio/x-wav", "wav"], ["audio/mp4", "m4a"], ["audio/webm", "webm"], ["audio/flac", "flac"], ["audio/aac", "aac"]])("maps %s to its actual container %s", async (mimeType, format) => {
    vi.mocked(fetch).mockResolvedValue(response({ text: "Bonjour" }));
    await new OpenRouterProvider().transcribeAudio({ ...audio, mimeType });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).input_audio.format).toBe(format);
  });

  it.each([{}, { text: "  " }, { text: 42 }, null])("rejects an unusable response: %j", async body => {
    vi.mocked(fetch).mockResolvedValue(response(body));
    await expect(new OpenRouterProvider().transcribeAudio(audio)).rejects.toThrow("transcription exploitable");
  });

  it.each([402, 429, 500])("reports HTTP %i without exposing the provider response", async status => {
    vi.mocked(fetch).mockResolvedValue(response({ error: "private transcript" }, status));
    await expect(new OpenRouterProvider().transcribeAudio(audio)).rejects.toThrow(`OpenRouter transcription error (${status}).`);
  });

  it("requires a key before sending an audio", async () => {
    config.OPENROUTER_API_KEY = undefined;
    await expect(new OpenRouterProvider().transcribeAudio(audio)).rejects.toThrow("OPENROUTER_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ data: Buffer.alloc(0), mimeType: "audio/ogg" }, { data: Buffer.alloc(25 * 1024 * 1024 + 1), mimeType: "audio/ogg" }, { ...audio, mimeType: "application/pdf" }])("rejects an invalid input before sending it", async input => {
    await expect(new OpenRouterProvider().transcribeAudio(input)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
