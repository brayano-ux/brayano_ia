/**
 * Extrait un montant numérique (FCFA) depuis le champ libre `Product.price` (ex. "25 000 FCFA" → 25000).
 * Renvoie null si le prix est absent, ne contient aucun nombre exploitable, ou en contient PLUSIEURS
 * (« Lot de 2 : 5 000 FCFA », « 5 000 à 7 000 FCFA », « 2 pour 5 000 ») : on ne devine pas lequel est le prix.
 * La négociation est alors simplement désactivée pour ce produit plutôt que de risquer un montant inventé
 * (lire « 2 » dans « Lot de 2 : 5 000 FCFA » ferait proposer l'article pour presque rien). Même règle que le
 * total des commandes (orders/order-logic.ts).
 */
export function parsePriceAmount(price: string | null | undefined): number | null {
  if (!price) return null;
  const groups = price.match(/\d[\d\s.,\u00a0\u202f]*/g);
  if (!groups || groups.length !== 1) return null;
  const digits = groups[0].replace(/[^\d]/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
