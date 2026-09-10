import { env } from "../config/env.js";
import { AiOrchestrator } from "./ai-orchestrator.js";
import type { AIProvider } from "./ai.types.js";
import { GeminiProvider } from "./providers/gemini.provider.js";

let orchestrator: AiOrchestrator | null = null;

function createProvider(): AIProvider {
  switch (env.LLM_PROVIDER) {
    case "gemini":
      return new GeminiProvider();
    // OpenAIProvider / GroqProvider viendront ici plus tard (Phase 0),
    // sans changer le reste de l'application.
    default:
      throw new Error(`Fournisseur IA non supporté : ${env.LLM_PROVIDER}`);
  }
}

export function getAiOrchestrator(): AiOrchestrator {
  if (!orchestrator) {
    orchestrator = new AiOrchestrator(createProvider());
  }
  return orchestrator;
}
