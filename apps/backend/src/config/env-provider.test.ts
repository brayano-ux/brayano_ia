import { describe, expect, it } from "vitest";
import { resolveDefaultProvider } from "./env.js";

describe("resolveDefaultProvider", () => {
  it("respecte LLM_PROVIDER quand il est renseigné", () => {
    expect(resolveDefaultProvider({ LLM_PROVIDER: "gemini", OPENROUTER_API_KEY: "k", GEMINI_API_KEY: "g" })).toBe("gemini");
  });

  it("choisit OpenRouter par défaut dès que sa clé existe", () => {
    expect(resolveDefaultProvider({ OPENROUTER_API_KEY: "k", GEMINI_API_KEY: "g", MISTRAL_API_KEY: "m" })).toBe("openrouter");
  });

  it("se rabat sur Gemini puis Mistral quand OpenRouter n'a pas de clé", () => {
    expect(resolveDefaultProvider({ GEMINI_API_KEY: "g", MISTRAL_API_KEY: "m" })).toBe("gemini");
    expect(resolveDefaultProvider({ MISTRAL_API_KEY: "m" })).toBe("mistral");
  });

  it("renvoie null sans aucune clé", () => {
    expect(resolveDefaultProvider({})).toBeNull();
  });
});
