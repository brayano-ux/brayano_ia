import { env, openRouterModels } from "../config/env.js";
import { AiOrchestrator } from "./ai-orchestrator.js";
import type { AIProvider } from "./ai.types.js";
import { GeminiProvider } from "./providers/gemini.provider.js";
import { MistralProvider } from "./providers/mistral.provider.js";
import { OpenRouterProvider } from "./providers/openrouter.provider.js";

let orchestrator: AiOrchestrator | null = null;

/** Réservé aux tests d'intégration : remplace l'orchestrateur IA par un faux (null pour revenir au vrai). */
export function setAiOrchestratorForTests(fake: Pick<AiOrchestrator, "getReply" | "transcribeAudio"> & Partial<Pick<AiOrchestrator, "analyzeMedia">> | null) {
  orchestrator = fake as AiOrchestrator | null;
}

type ProviderName = "gemini" | "openrouter" | "mistral";

function hasKey(name: ProviderName): boolean {
  if (name === "gemini") return Boolean(env.GEMINI_API_KEY);
  if (name === "openrouter") return Boolean(env.OPENROUTER_API_KEY);
  return Boolean(env.MISTRAL_API_KEY);
}

/** Un fournisseur par entrée, sauf OpenRouter : un par modèle listé dans OPENROUTER_MODEL. */
function instantiate(name: ProviderName): AIProvider[] {
  if (name === "gemini") return [new GeminiProvider()];
  if (name === "openrouter") return openRouterModels(env.OPENROUTER_MODEL).map((model) => new OpenRouterProvider(model));
  return [new MistralProvider()];
}

/**
 * Ordre d'essai des fournisseurs : celui choisi par LLM_PROVIDER d'abord, puis TOUS les autres dont la clé est
 * configurée (Gemini, OpenRouter, Mistral). Une clé renseignée est donc toujours un secours réel.
 */
export function providerOrder(): ProviderName[] {
  const primary = env.LLM_PROVIDER as ProviderName;
  const others = (["gemini", "openrouter", "mistral"] as const).filter((name) => name !== primary && hasKey(name));
  return [primary, ...others];
}

/** Fournisseurs instanciés dans l'ordre d'essai (principal puis secours). Le principal doit avoir sa clé (vérifié dans config/env.ts). */
export function getRawProviders(): AIProvider[] {
  const providers: AIProvider[] = [];
  for (const name of providerOrder()) {
    try {
      providers.push(...instantiate(name));
    } catch (error) {
      console.warn("Fournisseur IA indisponible :", error instanceof Error ? error.message : error);
    }
  }
  return providers;
}

/** « openrouter (openai/gpt-4o-mini) », « gemini »… pour les journaux. */
export function describeProvider(provider: AIProvider): string {
  return provider.model ? `${provider.name} (${provider.model})` : provider.name;
}

export function getAiOrchestrator(): AiOrchestrator {
  if (!orchestrator) {
    const providers = getRawProviders();
    orchestrator = new AiOrchestrator(providers);
    console.log(`🤖 Fournisseurs IA, dans l'ordre d'essai : ${providers.map(describeProvider).join(" → ")}`);
  }
  return orchestrator;
}
