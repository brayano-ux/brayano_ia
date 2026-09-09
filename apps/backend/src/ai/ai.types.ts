export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIRequestInput {
  systemPrompt: string;
  history: AIChatMessage[];
}

export interface AIRawResult {
  rawText: string;
  latencyMs: number;
}

/**
 * Contrat stable entre l'orchestrateur et le fournisseur LLM concret.
 * Aucune autre partie de l'application ne doit importer un SDK LLM
 * directement — uniquement les classes dans ai/providers/.
 */
export interface AIProvider {
  readonly name: string;
  generateResponse(input: AIRequestInput): Promise<AIRawResult>;
}
