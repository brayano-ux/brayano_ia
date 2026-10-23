import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./ai-runs.service.js", () => ({ logAiRun: vi.fn() }));
vi.mock("../config/env.js", () => ({ env: {} }));
import { AiOrchestrator } from "./ai-orchestrator.js";
import type { AIProvider } from "./ai.types.js";
const audio = { data: Buffer.from("audio"), mimeType: "audio/ogg; codecs=opus" };
const provider = (name: string) => ({ name, generateResponse: vi.fn(), transcribeAudio: vi.fn() } satisfies AIProvider);
afterEach(() => vi.useRealTimers());

describe("audio transcription fallback", () => {
  it("keeps the primary transcript and does not call the fallback", async () => {
    const primary = provider("gemini"), backup = provider("openrouter");
    primary.transcribeAudio.mockResolvedValue(" Bonjour ");
    expect(await new AiOrchestrator(primary, backup).transcribeAudio(audio)).toBe("Bonjour");
    expect(backup.transcribeAudio).not.toHaveBeenCalled();
  });

  it.each(["error", "empty"])("uses OpenRouter when Gemini returns %s", async failure => {
    const primary = provider("gemini"), backup = provider("openrouter");
    if (failure === "error") primary.transcribeAudio.mockRejectedValue(new Error("quota"));
    else primary.transcribeAudio.mockResolvedValue("  ");
    backup.transcribeAudio.mockResolvedValue("Abeg, I wan book.");
    expect(await new AiOrchestrator(primary, backup).transcribeAudio(audio)).toBe("Abeg, I wan book.");
    expect(backup.transcribeAudio).toHaveBeenCalledWith(audio);
  });

  it("also works with OpenRouter as primary and Gemini as fallback", async () => {
    const primary = provider("openrouter"), backup = provider("gemini");
    primary.transcribeAudio.mockRejectedValue(new Error("credits"));
    backup.transcribeAudio.mockResolvedValue("Bonjour");
    expect(await new AiOrchestrator(primary, backup).transcribeAudio(audio)).toBe("Bonjour");
  });

  it("tries the fallback after 60 seconds instead of waiting forever", async () => {
    vi.useFakeTimers();
    const primary = provider("gemini"), backup = provider("openrouter");
    primary.transcribeAudio.mockImplementation(() => new Promise(() => {}));
    backup.transcribeAudio.mockResolvedValue("Bonjour");
    const pending = new AiOrchestrator(primary, backup).transcribeAudio(audio);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toBe("Bonjour");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout after a fast success", async () => {
    vi.useFakeTimers();
    const primary = provider("gemini"); primary.transcribeAudio.mockResolvedValue("Bonjour");
    expect(await new AiOrchestrator(primary).transcribeAudio(audio)).toBe("Bonjour");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("raises a controlled failure when neither provider can transcribe", async () => {
    const primary = provider("gemini"), backup = provider("openrouter");
    primary.transcribeAudio.mockRejectedValue(new Error("quota"));
    backup.transcribeAudio.mockResolvedValue("");
    await expect(new AiOrchestrator(primary, backup).transcribeAudio(audio)).rejects.toThrow("Aucun fournisseur IA");
  });
});
