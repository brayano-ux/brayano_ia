/**
 * Négociation de prix : le CODE calcule toujours le prix exact (jamais l'IA, voir ai/schemas.ts
 * `wantsDiscount`), par petits paliers dégressifs jusqu'à un prix plancher fixé par le pourcentage de
 * remise maximale autorisé par le marchand. L'IA se contente de présenter ce prix naturellement
 * (voir buildNegotiationInstruction) sans jamais révéler de calcul, de pourcentage ou de plancher.
 */
export interface NegotiationState {
  productId: string;
  basePrice: number;
  floorPrice: number;
  round: number;
  currentPrice: number;
}

/** Nombre maximum de baisses de prix progressives accordées avant de tenir ferme sur le prix plancher. */
export const MAX_NEGOTIATION_ROUNDS = 3;

export function isNegotiationState(value: unknown): value is NegotiationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.productId === "string" &&
    typeof candidate.basePrice === "number" &&
    typeof candidate.floorPrice === "number" &&
    typeof candidate.round === "number" &&
    typeof candidate.currentPrice === "number"
  );
}

export function startNegotiation(
  productId: string,
  basePrice: number,
  maxDiscountPercent: number,
): NegotiationState {
  const clampedPercent = Math.min(Math.max(maxDiscountPercent, 0), 50);
  const floorPrice = Math.max(Math.round((basePrice * (1 - clampedPercent / 100)) / 100) * 100, 0);
  return { productId, basePrice, floorPrice, round: 0, currentPrice: basePrice };
}

/**
 * Calcule la prochaine offre : une baisse d'environ 45 % de l'écart restant jusqu'au plancher, arrondie
 * à la centaine, jamais en dessous du plancher, et plus aucune baisse après MAX_NEGOTIATION_ROUNDS.
 */
export function nextNegotiationOffer(
  state: NegotiationState,
): { price: number; state: NegotiationState; isFinal: boolean } {
  const round = state.round + 1;
  const atFloor = state.currentPrice <= state.floorPrice;

  let price: number;
  if (round >= MAX_NEGOTIATION_ROUNDS || atFloor) {
    price = state.floorPrice;
  } else {
    const gap = state.currentPrice - state.floorPrice;
    price = Math.max(Math.round((state.currentPrice - gap * 0.45) / 100) * 100, state.floorPrice);
  }

  const isFinal = price <= state.floorPrice || round >= MAX_NEGOTIATION_ROUNDS;
  return { price, state: { ...state, round, currentPrice: price }, isFinal };
}

/** Instruction injectée dans le prompt lors du rappel IA (voir claim-guard pour le même procédé). */
export function buildNegotiationInstruction(price: number, isFinal: boolean): string {
  return `
NÉGOCIATION EN COURS

Le client cherche à obtenir un meilleur prix sur ce produit. Propose EXACTEMENT ${price} FCFA, présenté naturellement et chaleureusement, comme un effort commercial que tu fais pour lui — jamais comme un calcul automatique.
${
    isFinal
      ? "C'est le dernier prix possible : dis-le clairement et gentiment, sans laisser croire qu'une nouvelle baisse suivra si le client insiste encore."
      : "Laisse entendre, sans le promettre formellement, qu'un petit effort supplémentaire reste possible s'il confirme sa commande maintenant."
  }
Ne mentionne jamais de pourcentage, de prix plancher, de calcul ou le mot « négociation ». Reste un vendeur naturel, pas un algorithme.
`.trim();
}
