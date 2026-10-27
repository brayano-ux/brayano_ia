/**
 * Extrait un montant numérique (FCFA) depuis le champ libre `Product.price` (ex. "25 000 FCFA" → 25000).
 * Renvoie null si le prix est absent ou ne contient aucun nombre exploitable — la négociation de prix
 * est alors simplement désactivée pour ce produit plutôt que de risquer un montant inventé.
 */
export function parsePriceAmount(price: string | null | undefined): number | null {
  if (!price) return null;
  const match = price.match(/\d[\d\s.,]*\d|\d/);
  if (!match) return null;
  const digits = match[0].replace(/[^\d]/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
