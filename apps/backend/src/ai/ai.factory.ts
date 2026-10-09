import { env } from "../config/env.js";
import { AiOrchestrator } from "./ai-orchestrator.js";
import type { AIProvider } from "./ai.types.js";
import { GeminiProvider } from "./providers/gemini.provider.js";
import { MistralProvider } from "./providers/mistral.provider.js";
import { OpenRouterProvider } from "./providers/openrouter.provider.js";

let orchestrator: AiOrchestrator | null = null;

function createProvider(): AIProvider {
  switch (env.LLM_PROVIDER) {
    case "gemini":
      return new GeminiProvider();
    case "mistral":
      return new MistralProvider();
    case "openrouter":
      return new OpenRouterProvider();
    default:
      throw new Error(`Fournisseur IA non supporté : ${env.LLM_PROVIDER}`);
  }
}

function createFallbackProvider(): AIProvider {
  if (env.LLM_PROVIDER === "gemini") return new OpenRouterProvider();
  return new GeminiProvider();
}

export function getAiOrchestrator(): AiOrchestrator {
  if (!orchestrator) {
    orchestrator = new AiOrchestrator(createProvider(), createFallbackProvider());
  }
  return orchestrator;
}

/** Fournisseurs bruts (principal puis secours) pour les tâches qui ne sont pas une réponse WhatsApp. */
export function getRawProviders(): AIProvider[] {
  const providers: AIProvider[] = [];
  for (const create of [createProvider, createFallbackProvider]) {
    try {
      providers.push(create());
    } catch (error) {
      console.warn("Fournisseur IA indisponible :", error instanceof Error ? error.message : error);
    }
  }
  return providers;
}
