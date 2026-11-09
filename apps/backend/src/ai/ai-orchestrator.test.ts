import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({ env: { GEMINI_MODEL: "gemini-test", OPENROUTER_MODEL: "openrouter-test", MISTRAL_MODEL: "mistral-test" } }));
vi.mock("./ai-runs.service.js", () => ({ logAiRun: vi.fn().mockResolvedValue(undefined) }));

import { AI_TIMEOUTS, AiOrchestrator, FALLBACK_REPLY, extractJsonObject, isRetryableError } from "./ai-orchestrator.js";
import type { AIProvider } from "./ai.types.js";

const validJson = (reply: string) => JSON.stringify({
  reply, intent: "demande_information", confidence: 0.9, needsHuman: false, leadScore: 20,
  qualificationStatus: "not_qualified", nextAction: "continue", leadData: {},
});

function provider(name: string, generate: AIProvider["generateResponse"]): AIProvider & { calls: number } {
  const fake = {
    name,
    calls: 0,
    generateResponse: async (input: Parameters<AIProvider["generateResponse"]>[0]) => { fake.calls += 1; return generate(input); },
    transcribeAudio: async () => "",
  };
  return fake;
}
const ok = (name: string, reply: string) => provider(name, async () => ({ rawText: validJson(reply), latencyMs: 10 }));
const failing = (name: string, message: string) => provider(name, async () => { throw new Error(message); });
const noWait = { wait: async () => {} };

describe("extractJsonObject", () => {
  it("retire les barrières ```json et le texte autour de l'objet", () => {
    expect(extractJsonObject('Voici la réponse :\n```json\n{"a":1}\n```\nMerci.')).toBe('{"a":1}');
    expect(extractJsonObject('Bien sûr ! {"a":1} (fin)')).toBe('{"a":1}');
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });
});

describe("isRetryableError", () => {
  it("réessaie sur quota, serveur en difficulté et coupure réseau, pas sur une clé invalide", () => {
    expect(isRetryableError(new Error("OpenRouter API error (429): rate limit"))).toBe(true);
    expect(isRetryableError(new Error("Mistral API error (503): overloaded"))).toBe(true);
    expect(isRetryableError(Object.assign(new Error("x"), { status: 500 }))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("OpenRouter API error (401): invalid key"))).toBe(false);
    expect(isRetryableError(Object.assign(new Error("x"), { status: 404 }))).toBe(false);
  });
});

describe("AiOrchestrator.getReply", () => {
  it("enchaîne tous les fournisseurs configurés jusqu'au premier qui répond", async () => {
    const gemini = failing("gemini", "Gemini API error (401): clé invalide");
    const openrouter = failing("openrouter", "OpenRouter API error (503): overloaded");
    const mistral = ok("mistral", "Bonjour depuis Mistral");
    const orchestrator = new AiOrchestrator([gemini, openrouter, mistral]);

    const reply = await orchestrator.getReply("conv", "prompt", [], noWait);

    expect(reply.reply).toBe("Bonjour depuis Mistral");
    expect(orchestrator.providerNames).toEqual(["gemini", "openrouter", "mistral"]);
    expect(gemini.calls).toBe(1); // 401 : pas de seconde tentative
    expect(openrouter.calls).toBe(2); // 503 : une seconde tentative avant de passer au suivant
    expect(mistral.calls).toBe(1);
  });

  it("réessaie une fois le même fournisseur sur une erreur passagère", async () => {
    let attempts = 0;
    const flaky = provider("gemini", async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("429 Too Many Requests: quota");
      return { rawText: validJson("Ça marche au second essai"), latencyMs: 5 };
    });
    const reply = await new AiOrchestrator(flaky).getReply("conv", "prompt", [], noWait);
    expect(reply.reply).toBe("Ça marche au second essai");
    expect(flaky.calls).toBe(2);
  });

  it("accepte une réponse entourée de ```json et passe au fournisseur suivant sur un JSON irrécupérable", async () => {
    const fenced = provider("gemini", async () => ({ rawText: "```json\n" + validJson("Avec barrières") + "\n```", latencyMs: 5 }));
    expect((await new AiOrchestrator(fenced).getReply("conv", "p", [], noWait)).reply).toBe("Avec barrières");

    const broken = provider("gemini", async () => ({ rawText: "Je ne peux pas répondre en JSON.", latencyMs: 5 }));
    const backup = ok("openrouter", "Secours");
    const reply = await new AiOrchestrator([broken, backup]).getReply("conv", "p", [], noWait);
    expect(reply.reply).toBe("Secours");
    expect(broken.calls).toBe(1); // une réponse mal formée ne vaut pas de seconde tentative
  });

  it("abandonne un fournisseur qui ne répond pas dans le délai et passe au suivant", async () => {
    vi.useFakeTimers();
    try {
      const hanging = provider("gemini", () => new Promise(() => {}));
      const backup = ok("openrouter", "Rapide");
      const pending = new AiOrchestrator([hanging, backup]).getReply("conv", "p", [], noWait);
      await vi.advanceTimersByTimeAsync(AI_TIMEOUTS.replyMs + 10);
      expect((await pending).reply).toBe("Rapide");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renvoie la réponse de repli SANS passage de main quand tout a échoué", async () => {
    const reply = await new AiOrchestrator([failing("gemini", "500"), failing("openrouter", "500")]).getReply("conv", "p", [], noWait);
    expect(reply).toEqual(FALLBACK_REPLY);
    expect(reply.intent).toBe("erreur_traitement");
    expect(reply.needsHuman).toBe(false);
    expect(reply.nextAction).toBe("continue");
  });

  it("garde la compatibilité avec l'ancienne construction (principal, secours)", async () => {
    const reply = await new AiOrchestrator(failing("gemini", "401"), ok("openrouter", "Ancien style")).getReply("conv", "p", [], noWait);
    expect(reply.reply).toBe("Ancien style");
  });
});
