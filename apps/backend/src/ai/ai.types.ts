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

export interface AIMediaInput {
  data: Buffer;
  mimeType: string;
  caption?: string | undefined;
}

export interface AIAudioInput {
  data: Buffer;
  mimeType: string;
}

/**
 * Contrat stable entre l'orchestrateur et le fournisseur LLM concret.
 * Aucune autre partie de l'application ne doit importer un SDK LLM
 * directement — uniquement les classes dans ai/providers/.
 */
export interface AIProvider {
  readonly name: string;
  generateResponse(input: AIRequestInput): Promise<AIRawResult>;
  transcribeAudio(input: AIAudioInput): Promise<string>;
  /** Optionnel : décrit une photo ou un document reçu (nécessite un modèle qui voit les images). */
  analyzeMedia?(input: AIMediaInput): Promise<string>;
}
