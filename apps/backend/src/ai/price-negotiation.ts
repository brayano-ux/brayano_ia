/**
 * Négociation de prix : le CODE calcule toujours le prix exact (jamais l'IA, voir ai/schemas.ts
 * `wantsDiscount`), par petits paliers dégressifs jusqu'à un prix plancher fixé par la remise maximale
 * autorisée par le marchand : un pourcentage du prix, ou un montant fixe qu'il saisit lui-même. L'IA se
 * contente de présenter ce prix naturellement (voir buildNegotiationInstruction) sans jamais révéler de
 * calcul, de pourcentage, de montant maximal ou de plancher.
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

/** Remise maximale autorisée : en pourcentage du prix, ou en montant fixe (même unité que les prix, FCFA). */
export type DiscountLimit = { mode: "percent"; value: number } | { mode: "amount"; value: number };

/** Quelle que soit la limite saisie, un article n'est jamais bradé de plus de la moitié de son prix. */
export const MAX_DISCOUNT_SHARE = 0.5;
export const DEFAULT_DISCOUNT_PERCENT = 10;

/** Limite configurée par le marchand. Un montant fixe absent ou invalide retombe sur le pourcentage. */
export function resolveDiscountLimit(settings: {
  negotiationDiscountMode?: string | null;
  negotiationMaxDiscountPercent?: number | null;
  negotiationMaxDiscountAmount?: number | null;
}): DiscountLimit {
  if (settings.negotiationDiscountMode === "amount" && typeof settings.negotiationMaxDiscountAmount === "number" && settings.negotiationMaxDiscountAmount > 0) {
    return { mode: "amount", value: settings.negotiationMaxDiscountAmount };
  }
  return { mode: "percent", value: settings.negotiationMaxDiscountPercent ?? DEFAULT_DISCOUNT_PERCENT };
}

/** Prix en dessous duquel l'agent ne descend jamais pour cet article. */
export function floorPriceFor(basePrice: number, limit: DiscountLimit): number {
  if (limit.mode === "amount") {
    // Le marchand a saisi un maximum exact : on arrondit le plancher à la centaine SUPÉRIEURE, pour ne jamais
    // accorder un franc de plus que ce montant. Et jamais plus de la moitié du prix d'un petit article.
    const discount = Math.min(Math.max(limit.value, 0), basePrice * MAX_DISCOUNT_SHARE);
    return Math.min(basePrice, Math.max(Math.ceil((basePrice - discount) / 100) * 100, 0));
  }
  const clampedPercent = Math.min(Math.max(limit.value, 0), MAX_DISCOUNT_SHARE * 100);
  return Math.max(Math.round((basePrice * (1 - clampedPercent / 100)) / 100) * 100, 0);
}

/**
 * Ouvre une négociation sur un article. `limit` est la remise maximale autorisée ; un simple nombre est lu comme
 * un pourcentage. Les paliers suivants (voir nextNegotiationOffer) sont les mêmes dans les deux cas.
 */
export function startNegotiation(
  productId: string,
  basePrice: number,
  limit: number | DiscountLimit,
): NegotiationState {
  const floorPrice = floorPriceFor(basePrice, typeof limit === "number" ? { mode: "percent", value: limit } : limit);
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
export function buildNegotiationInstruction(price: number, isFinal: boolean, productName?: string): string {
  const subject = productName ? `l'article « ${productName} »` : "ce produit";
  return `
NÉGOCIATION EN COURS

Le client cherche à obtenir un meilleur prix sur ${subject}. Propose EXACTEMENT ${price} FCFA pour ${subject}, présenté naturellement et chaleureusement, comme un effort commercial que tu fais pour lui — jamais comme un calcul automatique. Ce prix ne concerne que cet article : ne l'applique à aucun autre produit.
${
    isFinal
      ? "C'est le dernier prix possible : dis-le clairement et gentiment, sans laisser croire qu'une nouvelle baisse suivra si le client insiste encore."
      : "Laisse entendre, sans le promettre formellement, qu'un petit effort supplémentaire reste possible s'il confirme sa commande maintenant."
  }
Ne mentionne jamais de pourcentage, de remise maximale, de prix plancher, de calcul ou le mot « négociation ». Reste un vendeur naturel, pas un algorithme.
`.trim();
}
