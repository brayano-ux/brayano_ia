/**
 * Garde-fou éthique : tout ce que l'IA propose doit être retrouvable dans la source
 * fournie par l'utilisateur. Rien n'est « complété » ou « arrangé ».
 *
 * 1. Chaque information doit être accompagnée d'une citation recopiée de la source,
 *    qui doit exister réellement dans celle-ci.
 * 2. Tous les faits vérifiables (emails, liens, téléphones, horaires, montants, nombres)
 *    de l'information doivent exister dans la source ; sinon la phrase est retirée.
 */

export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9@+:/._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Facts {
  emails: Set<string>;
  urls: Set<string>;
  phones: Set<string>;
  times: Set<string>;
  numbers: Set<string>;
}

function canonicalTime(hours: string, minutes: string | undefined) {
  const h = Number(hours);
  const m = minutes ? Number(minutes) : 0;
  if (h > 24 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function extractFacts(rawText: string): Facts {
  const facts: Facts = { emails: new Set(), urls: new Set(), phones: new Set(), times: new Set(), numbers: new Set() };
  let text = rawText.normalize("NFC");

  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (match) => {
    facts.emails.add(match.toLowerCase());
    return " ";
  });

  text = text.replace(/(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi, (match) => {
    facts.urls.add(normalizeUrl(match));
    return " ";
  });

  // Heures : 8h, 8h30, 08:00, 8 h 30 (et non « 2024 » ou « 5000 »).
  text = text.replace(/\b(\d{1,2})\s?(?:h|:)\s?(\d{2})?\b/gi, (match, hours: string, minutes: string | undefined) => {
    const time = canonicalTime(hours, minutes);
    if (!time) return match;
    facts.times.add(time);
    return " ";
  });

  // Téléphones : au moins 8 chiffres séparés par espaces, points, tirets ou parenthèses.
  text = text.replace(/\+?\d[\d\s().-]{6,}\d/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) {
      facts.phones.add(digits);
      return " ";
    }
    return match;
  });

  for (const match of text.matchAll(/\d+(?:[\s.,  ]\d{3})*(?:[.,]\d+)?/g)) {
    facts.numbers.add(match[0].replace(/\D/g, "").replace(/^0+(?=\d)/, ""));
  }
  return facts;
}

function normalizeUrl(url: string) {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[.,;:!?)]+$/, "")
    .replace(/\/+$/, "");
}

function phoneInSource(phone: string, sourcePhones: Set<string>) {
  for (const candidate of sourcePhones) {
    if (candidate === phone) return true;
    // Indicatif pays présent d'un seul côté (237 6xx… / 6xx…).
    const [long, short] = candidate.length >= phone.length ? [candidate, phone] : [phone, candidate];
    if (short.length >= 8 && long.endsWith(short)) return true;
  }
  return false;
}

/** Faits de `value` absents de la source. Liste vide = tout est vérifiable. */
export function findUngroundedFacts(value: string, source: Facts): string[] {
  const facts = extractFacts(value);
  const missing: string[] = [];
  for (const email of facts.emails) if (!source.emails.has(email)) missing.push(email);
  for (const url of facts.urls) if (!source.urls.has(url)) missing.push(url);
  for (const phone of facts.phones) if (!phoneInSource(phone, source.phones)) missing.push(phone);
  for (const time of facts.times) if (!source.times.has(time)) missing.push(time);
  for (const number of facts.numbers) if (!source.numbers.has(number)) missing.push(number);
  return missing;
}

/** La citation (ou chacun de ses fragments séparés par « … ») doit figurer dans la source. */
export function quoteExistsInSource(quote: string, normalizedSource: string): boolean {
  const fragments = quote
    .split(/…|\.{3}/)
    .map(normalizeForSearch)
    .filter((fragment) => fragment.length >= 4);
  if (fragments.length === 0) return false;
  return fragments.every((fragment) => normalizedSource.includes(fragment));
}

/** Retire les phrases contenant un fait non vérifiable. */
export function pruneUngroundedSentences(value: string, source: Facts): { text: string; removed: string[] } {
  const sentences = value.split(/(?<=[.!?;\n])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const sentence of sentences) {
    const ungrounded = findUngroundedFacts(sentence, source);
    if (ungrounded.length === 0) kept.push(sentence);
    else removed.push(`${sentence} (${ungrounded.join(", ")})`);
  }
  return { text: kept.join(" "), removed };
}
