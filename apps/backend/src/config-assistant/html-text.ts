/** Convertit du HTML en texte brut lisible, sans dépendance. */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", ocirc: "ô", icirc: "î", ucirc: "û", rsquo: "’", lsquo: "‘", laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—" };

function decodeEntities(text: string) {
  return text
    .replace(/&#(\d{1,6});/g, (_m, code) => safeChar(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, code) => safeChar(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeChar(code: number) {
  return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
}

export function htmlToText(html: string, maxChars = 40_000): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]
    ?? /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1];

  // Les liens tel:/mailto: contiennent souvent le seul numéro / email exact de la page.
  const contactLinks = [...html.matchAll(/href=["'](tel|mailto):([^"'?#]+)/gi)]
    .map((match) => `${match[1]!.toLowerCase() === "tel" ? "Téléphone" : "Email"} : ${decodeURIComponent(match[2]!)}`);

  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/header|\/footer)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const text = decodeEntities([title, description, body, ...contactLinks].filter(Boolean).join("\n"))
    .replace(/[ \t  ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return text.slice(0, maxChars);
}

/** Liens internes utiles (contact, à propos, tarifs, livraison…), même domaine, 3 maximum. */
export function findUsefulLinks(html: string, pageUrl: string, limit = 3): string[] {
  const base = new URL(pageUrl);
  const wanted = /contact|a-propos|apropos|about|propos|service|tarif|prix|horaire|livraison|delivery|faq|boutique|nous/i;
  const found = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const link = new URL(match[1]!, base);
      if (link.hostname !== base.hostname || !/^https?:$/.test(link.protocol)) continue;
      if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js)$/i.test(link.pathname)) continue;
      if (link.pathname === base.pathname || !wanted.test(link.pathname)) continue;
      link.hash = "";
      found.add(link.toString());
    } catch {
      // lien invalide : ignoré
    }
    if (found.size >= limit) break;
  }
  return [...found];
}
