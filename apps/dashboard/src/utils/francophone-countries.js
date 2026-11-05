/**
 * Pays francophones d'Afrique, avec leur indicatif téléphonique (E.164) et leur drapeau.
 * Le Cameroun est en tête (marché d'origine, valeur par défaut) ; les autres sont triés par nom.
 * Tous les indicatifs ci-dessous font 3 chiffres et sont uniques entre eux : on peut donc
 * retrouver sans ambiguïté le pays d'un numéro complet à partir de ses 3 premiers chiffres.
 */
export const FRANCOPHONE_AFRICAN_COUNTRIES = [
  { name: "Cameroun", flag: "🇨🇲", dialCode: "237" },
  { name: "Algérie", flag: "🇩🇿", dialCode: "213" },
  { name: "Bénin", flag: "🇧🇯", dialCode: "229" },
  { name: "Burkina Faso", flag: "🇧🇫", dialCode: "226" },
  { name: "Burundi", flag: "🇧🇮", dialCode: "257" },
  { name: "Comores", flag: "🇰🇲", dialCode: "269" },
  { name: "Congo-Brazzaville", flag: "🇨🇬", dialCode: "242" },
  { name: "Côte d'Ivoire", flag: "🇨🇮", dialCode: "225" },
  { name: "Djibouti", flag: "🇩🇯", dialCode: "253" },
  { name: "Gabon", flag: "🇬🇦", dialCode: "241" },
  { name: "Guinée", flag: "🇬🇳", dialCode: "224" },
  { name: "Guinée équatoriale", flag: "🇬🇶", dialCode: "240" },
  { name: "Madagascar", flag: "🇲🇬", dialCode: "261" },
  { name: "Mali", flag: "🇲🇱", dialCode: "223" },
  { name: "Maroc", flag: "🇲🇦", dialCode: "212" },
  { name: "Mauritanie", flag: "🇲🇷", dialCode: "222" },
  { name: "Niger", flag: "🇳🇪", dialCode: "227" },
  { name: "République centrafricaine", flag: "🇨🇫", dialCode: "236" },
  { name: "République démocratique du Congo", flag: "🇨🇩", dialCode: "243" },
  { name: "Rwanda", flag: "🇷🇼", dialCode: "250" },
  { name: "Sénégal", flag: "🇸🇳", dialCode: "221" },
  { name: "Seychelles", flag: "🇸🇨", dialCode: "248" },
  { name: "Tchad", flag: "🇹🇩", dialCode: "235" },
  { name: "Togo", flag: "🇹🇬", dialCode: "228" },
  { name: "Tunisie", flag: "🇹🇳", dialCode: "216" },
];

const DEFAULT_DIAL_CODE = "237";

export function findCountryByDialCode(dialCode) {
  return FRANCOPHONE_AFRICAN_COUNTRIES.find((country) => country.dialCode === dialCode) ?? null;
}

/**
 * Sépare un numéro complet (chiffres seuls, ex. "237690000000") en indicatif + numéro local,
 * en reconnaissant l'indicatif parmi la liste ci-dessus. Retourne null si aucun indicatif connu
 * ne correspond (numéro d'un pays hors de cette liste, ou valeur vide).
 */
export function splitWhatsAppNumber(digits) {
  const clean = String(digits ?? "").replace(/\D/g, "");
  if (!clean) return null;
  const country = FRANCOPHONE_AFRICAN_COUNTRIES.find((candidate) => clean.startsWith(candidate.dialCode));
  if (!country) return null;
  const local = clean.slice(country.dialCode.length);
  if (!local) return null;
  return { dialCode: country.dialCode, local, country };
}

export function defaultDialCode() {
  return DEFAULT_DIAL_CODE;
}
