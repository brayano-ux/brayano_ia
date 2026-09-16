import { env } from "../config/env.js";
import { AiOrchestrator } from "./ai-orchestrator.js";
import type { AIProvider } from "./ai.types.js";
import { GeminiProvider } from "./providers/gemini.provider.js";
import { MistralProvider } from "./providers/mistral.provider.js";

let orchestrator: AiOrchestrator | null = null;

function createProvider(): AIProvider {
  switch (env.LLM_PROVIDER) {
    case "gemini":
      return new GeminiProvider();
    case "mistral":
      return new MistralProvider();
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
