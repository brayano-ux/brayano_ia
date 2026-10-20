/**
 * Numéro WhatsApp d'une entreprise : saisi par le propriétaire à l'inscription, stocké sous forme de chiffres seuls
 * avec l'indicatif pays (ex. 237690000000), comme l'attend WhatsApp pour le code d'association.
 */

/** Cameroun par défaut : un mobile à 9 chiffres commençant par 6 (« 690 00 00 00 ») reçoit l'indicatif 237. */
const DEFAULT_COUNTRY_CODE = "237";

/** Renvoie les chiffres avec indicatif pays, ou null si le numéro n'est pas exploitable. */
export function normalizeWhatsAppNumber(input: string, defaultCountryCode = DEFAULT_COUNTRY_CODE): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;

  const international = compact.startsWith("+") || compact.startsWith("00");
  let digits = compact.replace(/^\+/, "").replace(/^00/, "");
  if (!international && /^6\d{8}$/.test(digits)) digits = `${defaultCountryCode}${digits}`;

  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** Affichage lisible : +237 6 90 00 00 00 pour le Cameroun, +chiffres sinon. */
export function formatWhatsAppNumber(digits: string): string {
  const cameroon = /^237(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(digits);
  if (cameroon) return `+237 ${cameroon[1]} ${cameroon[2]} ${cameroon[3]} ${cameroon[4]} ${cameroon[5]}`;
  return `+${digits}`;
}

/** Compare deux numéros en ignorant la mise en forme et le suffixe d'appareil WhatsApp (« :12 »). */
export function sameWhatsAppNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const clean = (value: string | null | undefined) => (value ?? "").split("@")[0]!.split(":")[0]!.replace(/\D/g, "");
  const left = clean(a);
  const right = clean(b);
  return Boolean(left) && Boolean(right) && left === right;
}
