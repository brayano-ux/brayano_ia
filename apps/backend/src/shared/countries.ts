/**
 * Pays africains francophones acceptés pour le numéro WhatsApp et le paiement : indicatif téléphonique (E.164)
 * et code ISO 3166-1 alpha-2 (attendu par Chariow dans `phone.country_code`).
 * Doit rester identique à la liste du tableau de bord (apps/dashboard/src/utils/francophone-countries.js) :
 * un test le vérifie. Tous les indicatifs font 3 chiffres et sont uniques, donc un numéro complet se rattache
 * sans ambiguïté à son pays par ses 3 premiers chiffres.
 */
export interface Country {
  name: string;
  dialCode: string;
  iso: string;
}

export const COUNTRIES: readonly Country[] = [
  { name: "Cameroun", dialCode: "237", iso: "CM" },
  { name: "Algérie", dialCode: "213", iso: "DZ" },
  { name: "Bénin", dialCode: "229", iso: "BJ" },
  { name: "Burkina Faso", dialCode: "226", iso: "BF" },
  { name: "Burundi", dialCode: "257", iso: "BI" },
  { name: "Comores", dialCode: "269", iso: "KM" },
  { name: "Congo-Brazzaville", dialCode: "242", iso: "CG" },
  { name: "Côte d'Ivoire", dialCode: "225", iso: "CI" },
  { name: "Djibouti", dialCode: "253", iso: "DJ" },
  { name: "Gabon", dialCode: "241", iso: "GA" },
  { name: "Guinée", dialCode: "224", iso: "GN" },
  { name: "Guinée équatoriale", dialCode: "240", iso: "GQ" },
  { name: "Madagascar", dialCode: "261", iso: "MG" },
  { name: "Mali", dialCode: "223", iso: "ML" },
  { name: "Maroc", dialCode: "212", iso: "MA" },
  { name: "Mauritanie", dialCode: "222", iso: "MR" },
  { name: "Niger", dialCode: "227", iso: "NE" },
  { name: "République centrafricaine", dialCode: "236", iso: "CF" },
  { name: "République démocratique du Congo", dialCode: "243", iso: "CD" },
  { name: "Rwanda", dialCode: "250", iso: "RW" },
  { name: "Sénégal", dialCode: "221", iso: "SN" },
  { name: "Seychelles", dialCode: "248", iso: "SC" },
  { name: "Tchad", dialCode: "235", iso: "TD" },
  { name: "Togo", dialCode: "228", iso: "TG" },
  { name: "Tunisie", dialCode: "216", iso: "TN" },
];

/**
 * Sépare un numéro international (chiffres seuls, ex. « 225070000000 ») en pays + numéro local.
 * Renvoie null si l'indicatif n'est pas dans la liste ou si le numéro local est vide.
 */
export function splitInternationalNumber(digits: string): { country: Country; local: string } | null {
  const clean = digits.replace(/\D/g, "");
  const country = COUNTRIES.find((candidate) => clean.startsWith(candidate.dialCode));
  if (!country) return null;
  const local = clean.slice(country.dialCode.length);
  return local ? { country, local } : null;
}
