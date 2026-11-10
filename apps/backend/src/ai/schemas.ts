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

/** Un nombre écrit en texte (« 80 », « 0,9 ») est converti ; une valeur hors bornes est ramenée dans l'intervalle. */
const tolerantNumber = (min: number, max: number, fallback: number) =>
  z.preprocess((value) => {
    const number = typeof value === "string" ? Number.parseFloat(value.replace(",", ".")) : value;
    if (typeof number !== "number" || Number.isNaN(number)) return fallback;
    return Math.min(Math.max(number, min), max);
  }, z.number().min(min).max(max));

/** Une valeur d'énumération écrite avec une casse ou des espaces différents (« Qualified ») est acceptée ; sinon la valeur de repli. */
const tolerantEnum = <T extends [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess((value) => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : value;
    return (values as readonly string[]).includes(normalized as string) ? normalized : fallback;
  }, z.enum(values));

/** Identifiant de produit : un UUID du catalogue, sinon chaîne vide (un nom de produit ou « null » écrit par le modèle est ignoré). */
const tolerantProductId = () => z.string().uuid().optional().or(z.literal("")).catch("");

/**
 * NE JAMAIS FAIRE CONFIANCE AU JSON RENVOYÉ PAR LE LLM (Phase 0).
 * Ce schéma est la seule porte d'entrée de la réponse IA vers le reste
 * de l'application. Si la validation échoue, l'orchestrateur bascule
 * sur needsHuman = true plutôt que de propager des données douteuses.
 */
export const aiReplySchema = z.object({
  // Le texte pour le client est la seule chose indispensable : tout le reste est toléré ou remplacé par une valeur sûre.
  reply: z.string().trim().min(1),
  intent: z.string().trim().min(1).catch("demande_information"),
  confidence: tolerantNumber(0, 1, 0.5),
  needsHuman: tolerantBoolean().catch(false),
  leadScore: tolerantNumber(0, 100, 0),
  qualificationStatus: tolerantEnum(["not_qualified", "qualifying", "qualified"], "not_qualified"),
  nextAction: tolerantEnum(["continue", "handoff", "stop"], "continue"),
  leadData: z.record(z.string(), z.unknown()).catch({}),
  productId: tolerantProductId(),
  /** Plusieurs produits dont le client veut voir les photos (5 au maximum sont envoyées). */
  productIds: z.array(z.string().uuid()).max(10).optional().catch(undefined),
  /**
   * Produit du catalogue dont le client parle dans CE message, photo ou pas (voir ai/prompt.ts). Sert à la
   * négociation de prix : quand le client passe à un autre article, la remise repart de son prix à lui, jamais
   * de celui de l'article précédent. Une valeur invalide écrite par le modèle est ignorée plutôt que de
   * faire échouer toute la réponse.
   */
  discussedProductId: tolerantProductId(),
  /**
   * Information demandée par le client que l'assistant n'avait pas (voir ai/prompt.ts). Montrée au propriétaire dans
   * ses statistiques pour qu'il complète les informations de son entreprise. Jamais envoyée au client.
   */
  missingInfo: z.preprocess((value) => (typeof value === "string" ? value.trim().slice(0, 200) : ""), z.string()).optional(),
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
