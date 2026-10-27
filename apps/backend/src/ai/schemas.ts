import { z } from "zod";
import { orderRequestSchema } from "../orders/order-logic.js";
import { bookingRequestSchema } from "../appointments/booking.js";

/**
 * Un modèle écrit parfois "true"/"false" en texte plutôt qu'un booléen JSON : on l'accepte aussi, pour
 * qu'une simple différence de format ne fasse pas échouer TOUTE la réponse (et ne bloque pas le client
 * par erreur — voir ai-orchestrator.ts, qui rejette l'intégralité de la réponse si un seul champ est invalide).
 */
const tolerantBoolean = () =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() === "true" : value),
    z.boolean(),
  );

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
  qualificationStatus: z.enum(["not_qualified", "qualifying", "qualified"]),
  nextAction: z.enum(["continue", "handoff", "stop"]),
  leadData: z.record(z.string(), z.unknown()).default({}),
  productId: z.string().uuid().optional().or(z.literal("")),
  /** Plusieurs produits dont le client veut voir les photos (3 au maximum sont envoyées). */
  productIds: z.array(z.string().uuid()).max(10).optional().catch(undefined),
  booking: bookingRequestSchema,
  order: orderRequestSchema,
  /** Rempli seulement quand un « sujet autorisé » est actif pour cette entreprise (voir ai/prompt.ts). */
  onTopic: tolerantBoolean().optional(),
  /**
   * Rempli seulement quand la négociation de prix est active (voir ai/prompt.ts) : le client demande une
   * réduction / un meilleur prix. Le serveur calcule ensuite lui-même le prix exact à proposer (voir
   * ai/price-negotiation.ts) — l'IA ne fait que signaler la demande, jamais le montant.
   */
  wantsDiscount: tolerantBoolean().optional(),
});

export type AIReply = z.infer<typeof aiReplySchema>;
