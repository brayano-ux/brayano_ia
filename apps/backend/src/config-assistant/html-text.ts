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

/** Au-delà, on ignore la suite : un site ne doit pas pouvoir nous faire travailler indéfiniment. */
const MAX_HTML_CHARS = 1_500_000;
/** Longueur de balise prise en compte pour lire ses attributs. */
const MAX_TAG_CHARS = 4_000;
const SKIPPED_ELEMENTS = new Set(["script", "style", "noscript", "svg", "template", "iframe"]);
const LINE_BREAK_TAGS = new Set(["br", "/p", "/div", "/li", "/tr", "/h1", "/h2", "/h3", "/h4", "/h5", "/h6", "/section", "/article", "/header", "/footer"]);

interface ScannedHtml {
  title: string | undefined;
  description: string | undefined;
  contactLinks: string[];
  links: string[];
  body: string;
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag.slice(0, MAX_TAG_CHARS))?.[1];
}

/**
 * Lecture du HTML en UN SEUL passage (temps proportionnel à la taille de la page, quoi qu'elle contienne).
 * Les anciennes expressions régulières devenaient quadratiques sur des pages truffées de balises jamais fermées.
 */
function scanHtml(source: string): ScannedHtml {
  const html = source.length > MAX_HTML_CHARS ? source.slice(0, MAX_HTML_CHARS) : source;
  const lower = html.toLowerCase();
  const result: ScannedHtml = { title: undefined, description: undefined, contactLinks: [], links: [], body: "" };
  const parts: string[] = [];
  let position = 0;

  while (position < html.length) {
    const open = html.indexOf("<", position);
    if (open === -1) {
      parts.push(html.slice(position));
      break;
    }
    if (open > position) parts.push(html.slice(position, open));
    const next = html.charAt(open + 1);
    if (!/[a-zA-Z/!?]/.test(next)) {
      parts.push("<");
      position = open + 1;
      continue;
    }

    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      if (end === -1) break;
      parts.push(" ");
      position = end + 3;
      continue;
    }

    const close = html.indexOf(">", open + 1);
    if (close === -1) break;
    const tag = html.slice(open + 1, close);
    const name = /^\/?[a-zA-Z0-9]+/.exec(tag)?.[0]?.toLowerCase() ?? "";
    position = close + 1;

    if (SKIPPED_ELEMENTS.has(name)) {
      const end = lower.indexOf(`</${name}`, position);
      if (end === -1) break;
      const endTag = html.indexOf(">", end);
      if (endTag === -1) break;
      parts.push(" ");
      position = endTag + 1;
      continue;
    }
    if (name === "title") {
      const end = lower.indexOf("</title", position);
      if (end === -1) break;
      result.title ??= html.slice(position, end);
      const endTag = html.indexOf(">", end);
      if (endTag === -1) break;
      position = endTag + 1;
      continue;
    }
    if (name === "meta" && result.description === undefined) {
      if (attribute(tag, "name")?.toLowerCase() === "description") result.description = attribute(tag, "content");
    }
    if (name === "a") {
      const href = attribute(tag, "href");
      if (href && result.links.length < 500) result.links.push(href);
    }
    if (tag.length < MAX_TAG_CHARS) {
      for (const match of tag.matchAll(/href=["'](tel|mailto):([^"'?#]+)/gi)) {
        let value = match[2]!;
        try {
          value = decodeURIComponent(value);
        } catch {
          // valeur mal encodée : gardée telle quelle
        }
        result.contactLinks.push(`${match[1]!.toLowerCase() === "tel" ? "Téléphone" : "Email"} : ${value}`);
      }
    }
    parts.push(LINE_BREAK_TAGS.has(name) ? "\n" : " ");
  }

  result.body = parts.join("");
  return result;
}

export function htmlToText(html: string, maxChars = 40_000): string {
  const { title, description, contactLinks, body } = scanHtml(html);

  const text = decodeEntities([title, description, body, ...contactLinks].filter(Boolean).join("\n"))
    .replace(/[ \t\u00a0\u202f]+/g, " ")
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
  for (const href of scanHtml(html).links) {
    if (!href || href.startsWith("#")) continue;
    try {
      const link = new URL(href.split("#")[0]!, base);
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
