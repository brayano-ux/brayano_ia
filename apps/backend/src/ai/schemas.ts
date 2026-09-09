import { z } from "zod";

/**
 * NE JAMAIS FAIRE CONFIANCE AU JSON RENVOYÉ PAR LE LLM (Phase 0).
 * Ce schéma est la seule porte d'entrée de la réponse IA vers le reste
 * de l'application. Si la validation échoue, l'orchestrateur bascule
 * sur needsHuman = true plutôt que de propager des données douteuses.
 */
export const aiReplySchema = z.object({
  reply: z.string().min(1),
  intent: z.string().min(1),
  confidence: z.number().min(0).max(1),
  needsHuman: z.boolean(),
  leadScore: z.number().min(0).max(100),
  leadData: z.record(z.string(), z.unknown()).default({}),
});

export type AIReply = z.infer<typeof aiReplySchema>;
