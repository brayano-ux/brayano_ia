import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" as string | undefined, GEMINI_API_KEY: undefined as string | undefined, OPENROUTER_TRANSCRIPTION_MODEL: "openai/whisper-1", APP_URL: "https://example.test" }));
vi.mock("../config/env.js", () => ({ env: config }));
vi.mock("./ai-runs.service.js", () => ({ logAiRun: vi.fn() }));
import { getAiOrchestrator, getRawProviders, setAiOrchestratorForTests } from "./ai.factory.js";

beforeEach(() => { setAiOrchestratorForTests(null); config.LLM_PROVIDER = "openrouter"; config.OPENROUTER_API_KEY = "test-key"; config.GEMINI_API_KEY = undefined; });
afterEach(() => { setAiOrchestratorForTests(null); vi.unstubAllGlobals(); });

describe("audio provider configuration", () => {
  it("transcribes with OpenRouter alone without requiring a Gemini key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "Bonjour" }), { status: 200 })));
    expect(await getAiOrchestrator().transcribeAudio({ data: Buffer.from("audio"), mimeType: "audio/ogg" })).toBe("Bonjour");
  });

  it("keeps Gemini usable alone when no OpenRouter key exists", () => {
    config.LLM_PROVIDER = "gemini"; config.GEMINI_API_KEY = "test-gemini-key"; config.OPENROUTER_API_KEY = undefined;
    expect(() => getAiOrchestrator()).not.toThrow();
    expect(getRawProviders().map(provider => provider.name)).toEqual(["gemini"]);
  });

  it("keeps Gemini then OpenRouter when both are configured", () => {
    config.LLM_PROVIDER = "gemini"; config.GEMINI_API_KEY = "test-gemini-key";
    expect(getRawProviders().map(provider => provider.name)).toEqual(["gemini", "openrouter"]);
  });
});
