import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BILLING_PLANS, TRIAL } from "../billing/billing-plans.js";
import { BROADCAST_LIMITS } from "../broadcasts/broadcast-rules.js";
import { CATALOG_MAX_PRODUCTS } from "../products/catalog-search.js";
import { MAX_PRODUCT_PHOTOS_PER_REPLY } from "../products/product-image-selection.js";

/**
 * Le site public (apps/dashboard : page d'accueil, pages de fonctionnalités, pages par activité, llms.txt, plan du site) répète les mêmes
 * faits à plusieurs endroits : le texte que lit le visiteur, les données structurées que lisent les moteurs de recherche,
 * et llms.txt que lisent les assistants IA. Ces tests garantissent que tous disent la même chose que les forfaits du code :
 * un prix, une question ou un numéro modifié à un seul endroit fait échouer la CI au lieu de partir en ligne.
 */
const site = path.resolve(__dirname, "../../../dashboard");
const read = (relative: string) => readFileSync(path.join(site, relative), "utf8");

const pagesIn = (directory: string) =>
  readdirSync(path.join(site, directory))
    .filter((file) => file.endsWith(".html"))
    .sort()
    .map((file) => `${directory}/${file}`);

/** Pages proposées aux moteurs de recherche. Le tableau de bord (/app/) porte « noindex » et n'en fait pas partie. */
const SECTOR_PAGES = pagesIn("assistant-whatsapp");
const PUBLIC_PAGES = ["index.html", ...pagesIn("fonctionnalites"), ...SECTOR_PAGES];
const LEGAL_PAGES = ["conditions.html", "confidentialite.html"];

const home = read("index.html");
/** L'adresse du site est lue une seule fois, sur la page d'accueil : tout le reste doit s'y conformer. */
const ORIGIN = /<link rel="canonical" href="(https:\/\/[^/"]+)\/" \/>/.exec(home)?.[1] ?? "";
const addressOf = (page: string) => `${ORIGIN}/${page === "index.html" ? "" : page}`;

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Les espaces insécables (milliers, ponctuation française) ne doivent pas faire échouer une comparaison de textes. */
const normalize = (text: string) => text.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

/** Le texte tel que le visiteur le lit : balises retirées, entités décodées. */
function visibleText(fragment: string): string {
  return normalize(fragment.replace(/<[^>]+>/g, "").replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity));
}

function section(html: string, id: string): string {
  return new RegExp(`<section id="${id}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";
}

type Node = Record<string, unknown>;

/** Tous les objets schema.org d'une page. Un bloc mal formé lève une erreur : Google, lui, l'ignorerait en silence. */
function structuredData(html: string): Node[] {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1] ?? "") as Node);
  return blocks.flatMap((block) => (Array.isArray(block["@graph"]) ? (block["@graph"] as Node[]) : [block]));
}

const ofType = (nodes: Node[], type: string): Node => nodes.find((node) => node["@type"] === type) ?? {};
const amount = (value: number) => normalize(new Intl.NumberFormat("fr-FR").format(value));
const fileBehind = (url: string) => {
  const relative = url.slice(ORIGIN.length + 1).split("#")[0] ?? "";
  return path.join(site, relative === "" || relative.endsWith("/") ? `${relative}index.html` : relative);
};

const plans = Object.values(BILLING_PLANS);
const homeData = structuredData(home);
const organization = ofType(homeData, "Organization");
const phone = String(organization.telephone ?? "");

describe("site public : ce que lisent les moteurs de recherche", () => {
  it("connaît l'adresse du site", () => {
    expect(ORIGIN).toMatch(/^https:\/\/[a-z0-9.-]+$/);
  });

  it("chaque page annonce sa langue, un titre et une description qui lui sont propres, son adresse et un seul titre principal", () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const page of PUBLIC_PAGES) {
      const html = read(page);
      // Longueurs mesurées sur le texte lu par Google (entités décodées), pas sur le code source.
      const title = visibleText(/<title>([^<]+)<\/title>/.exec(html)?.[1] ?? "");
      const description = visibleText(/<meta name="description" content="([^"]+)"/.exec(html)?.[1] ?? "");

      expect(html, `${page} : langue`).toMatch(/<html lang="fr">/);
      expect(title.length, `${page} : titre absent`).toBeGreaterThan(10);
      expect(title.length, `${page} : titre trop long, Google le couperait`).toBeLessThanOrEqual(65);
      expect(description.length, `${page} : description trop courte`).toBeGreaterThanOrEqual(70);
      expect(description.length, `${page} : description trop longue, Google la couperait`).toBeLessThanOrEqual(165);
      expect(titles.has(title), `${page} : titre déjà utilisé par une autre page`).toBe(false);
      expect(descriptions.has(description), `${page} : description déjà utilisée par une autre page`).toBe(false);
      titles.add(title);
      descriptions.add(description);

      expect(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1], `${page} : adresse canonique`).toBe(addressOf(page));
      expect(/<meta property="og:url" content="([^"]+)"/.exec(html)?.[1], `${page} : adresse de partage`).toBe(addressOf(page));
      const shareImage = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? "";
      expect(shareImage.startsWith(`${ORIGIN}/`) && existsSync(fileBehind(shareImage)), `${page} : image de partage introuvable`).toBe(true);

      expect(html.match(/<h1[\s>]/g)?.length, `${page} : un seul titre principal <h1>`).toBe(1);
      expect(html, `${page} : la page ne doit pas se cacher de Google`).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
    }
  });

  it("les données structurées sont lisibles et ne citent que des adresses de ce site qui existent", () => {
    for (const page of PUBLIC_PAGES) {
      const nodes = structuredData(read(page));
      expect(nodes.length, `${page} : aucune donnée structurée`).toBeGreaterThan(0);
      for (const url of JSON.stringify(nodes).match(/https:\/\/[^"\\ ]+/g) ?? []) {
        if (url === "https://schema.org" || url.startsWith("https://wa.me/")) continue;
        expect(url.startsWith(`${ORIGIN}/`), `${page} : ${url} n'est pas une adresse du site`).toBe(true);
        expect(existsSync(fileBehind(url)), `${page} : ${url} ne correspond à aucun fichier`).toBe(true);
      }
    }
  });

  it("le plan du site liste chaque page publique, rien d'autre, et robots.txt y conduit sans rien interdire", () => {
    const listed = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? "");
    expect([...listed].sort()).toEqual(PUBLIC_PAGES.map(addressOf).sort());

    const robots = read("robots.txt");
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    const everyRobot = robots.split(/\n\s*\n/).find((group) => /^User-agent:\s*\*\s*$/m.test(group)) ?? "";
    expect(everyRobot, "robots.txt interdit tout le site à tous les robots").not.toMatch(/^Disallow:\s*\/\s*$/m);
  });

  it("chaque page publique garde la politique de contenu stricte : ni script ni gestionnaire d'événement en ligne", () => {
    for (const page of PUBLIC_PAGES) {
      const html = read(page);
      const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
      expect(policy, page).toContain("script-src 'self'");
      expect(policy, page).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
      // Les blocs de données JSON-LD ne s'exécutent pas : ce sont les seuls <script> sans fichier autorisés.
      expect(html.match(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/gi) ?? [], page).toEqual([]);
      expect(html, `${page} : gestionnaire d'événement en ligne`).not.toMatch(/\son(click|error|load|submit|change)\s*=\s*["']/i);
    }
  });

  it("le tableau de bord, lui, reste hors de Google", () => {
    expect(read("app/index.html")).toMatch(/<meta name="robots" content="noindex" \/>/);
  });
});

describe("site public : les mêmes faits partout (une seule vérité)", () => {
  it("les cartes de tarifs affichent mot pour mot les lignes des forfaits", () => {
    const cards = [...section(home, "tarifs").matchAll(/<article class="plan[^"]*">([\s\S]*?)<\/article>/g)].map((match) => match[1] ?? "");
    expect(cards).toHaveLength(plans.length);
    plans.forEach((plan, index) => {
      const card = cards[index] ?? "";
      expect(visibleText(/<h3>([\s\S]*?)<\/h3>/.exec(card)?.[1] ?? "")).toBe(plan.name);
      expect(visibleText(/<p class="price"><strong>([\s\S]*?)<\/strong>/.exec(card)?.[1] ?? "")).toBe(`${amount(plan.amount)} FCFA`);
      const lines = [...card.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => visibleText(match[1] ?? ""));
      expect(lines, `carte « ${plan.name} »`).toEqual(plan.highlights.map(normalize));
    });
  });

  it("les forfaits des données structurées sont ceux du code : nom, prix en FCFA, contenu", () => {
    const offers = (ofType(homeData, "SoftwareApplication").offers ?? []) as Array<Record<string, string>>;
    expect(offers.map((offer) => offer.name)).toEqual(plans.map((plan) => plan.name));
    plans.forEach((plan, index) => {
      const offer = offers[index] ?? {};
      expect(offer.price, `prix balisé du forfait « ${plan.name} »`).toBe(String(plan.amount));
      expect(offer.priceCurrency).toBe("XAF");
      for (const line of plan.highlights) expect(normalize(offer.description ?? ""), `forfait balisé « ${plan.name} »`).toContain(normalize(line));
    });
  });

  it("chaque FAQ balisée reprend mot pour mot les questions et les réponses affichées sur sa page", () => {
    const withFaq = PUBLIC_PAGES.filter((page) => ofType(structuredData(read(page)), "FAQPage").mainEntity);
    expect(withFaq).toEqual(["index.html", ...SECTOR_PAGES]);
    for (const page of withFaq) {
      const html = read(page);
      const block = /<div class="faq">[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
      const visible = [...block.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((match) => [
        visibleText(match[1] ?? ""),
        visibleText(match[2] ?? ""),
      ]);
      const marked = (ofType(structuredData(html), "FAQPage").mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>).map((question) => [
        normalize(question.name),
        normalize(question.acceptedAnswer.text),
      ]);
      expect(visible.length, `${page} : aucune question affichée`).toBeGreaterThan(0);
      expect(marked, `${page} : la FAQ balisée diffère de la FAQ affichée`).toEqual(visible);
    }
  });

  it("l'éditeur, la ville et le numéro des données structurées sont écrits sur la page", () => {
    const text = visibleText(home.slice(home.indexOf("<body")));
    const address = (organization.address ?? {}) as Record<string, string>;
    expect(phone).toMatch(/^\+\d{9,15}$/);
    expect(text.replace(/\s/g, "")).toContain(phone);
    expect(text).toContain(String(organization.legalName));
    expect(text).toContain(String(address.addressLocality));
    expect(String(ofType(homeData, "WebSite").name)).toBe(String(organization.name));
    expect(String(ofType(homeData, "SoftwareApplication").name)).toBe(String(organization.name));
  });

  it("un seul numéro WhatsApp sur tout le site", () => {
    for (const page of [...PUBLIC_PAGES, ...LEGAL_PAGES]) {
      const numbers = new Set([...read(page).matchAll(/wa\.me\/(\d+)/g)].map((match) => match[1]));
      expect([...numbers], `${page} : numéro WhatsApp`).toEqual([phone.slice(1)]);
    }
  });
});

describe("site public : pages par activité (assistant-whatsapp/)", () => {
  const numbers = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((match) => Number((match[1] ?? "").replace(/\s/g, "")));

  it("existent pour les cinq activités annoncées et sont reliées depuis la page d'accueil et entre elles", () => {
    expect(SECTOR_PAGES).toHaveLength(5);
    for (const page of SECTOR_PAGES) {
      expect(home, `la page d'accueil ne mène pas à ${page}`).toContain(`href="${page}"`);
      const html = read(page);
      for (const other of SECTOR_PAGES) expect(html, `${page} ne mène pas à ${other}`).toContain(`href="${path.basename(other)}"`);
      expect(html, `${page} : exemple de conversation non signalé comme fictif`).toContain("Exemple illustratif, avec un nom et des prix fictifs.");
    }
  });

  it("citent les prix, les quantités de messages, les employés et l'essai des forfaits du code", () => {
    const byName = new Map(plans.map((plan) => [plan.name, plan]));
    for (const page of SECTOR_PAGES) {
      const html = read(page);
      const text = visibleText(html.slice(html.indexOf("<main"), html.indexOf("</main>")));
      const prices = [...text.matchAll(/forfait (Essentiel|Pro|Business)\D{0,12}?(\d[\d ]*) FCFA par mois/g)];
      expect(prices.length, `${page} : aucun prix de forfait`).toBeGreaterThan(0);
      for (const [, name, value] of prices) expect(Number((value ?? "").replace(/\s/g, "")), `${page} : prix du forfait ${name}`).toBe(byName.get(name ?? "")?.amount);
      for (const value of numbers(text, /(\d[\d ]*) messages de l'assistant/g)) expect(plans.map((plan) => plan.messages), `${page} : ${value} messages`).toContain(value);
      for (const value of numbers(text, /(\d+) employés/g)) expect(plans.map((plan) => plan.features.teamMembers), `${page} : ${value} employés`).toContain(value);
      for (const value of numbers(text, /(\d+) (?:messages offerts|réponses offertes)/g)) expect(value, `${page} : essai gratuit`).toBe(TRIAL.messages);
    }
  });

  it("citent les limites réellement appliquées par le serveur (messages groupés, catalogue, photos)", () => {
    for (const page of SECTOR_PAGES) {
      const html = read(page);
      const text = visibleText(html.slice(html.indexOf("<main"), html.indexOf("</main>")));
      for (const value of numbers(text, /lots de (\d+)/g)) expect(value, `${page} : taille d'un lot`).toBe(BROADCAST_LIMITS.maxRecipientsPerBroadcast);
      for (const value of numbers(text, /(\d+) messages par 24 h/g)) expect(value, `${page} : messages groupés par 24 h`).toBe(BROADCAST_LIMITS.maxPerDay);
      for (const value of numbers(text, /ou (\d+) derniers jours/g)) expect(value, `${page} : ancienneté maximale d'un destinataire`).toBe(BROADCAST_LIMITS.maxWindowDays);
      for (const value of numbers(text, /jusqu'à (\d+) articles actifs/g)) expect(value, `${page} : taille du catalogue`).toBe(CATALOG_MAX_PRODUCTS);
      for (const value of numbers(text, /jusqu'à (\d+) photos/g)) expect(value, `${page} : photos par réponse`).toBe(MAX_PRODUCT_PHOTOS_PER_REPLY);
    }
  });
});

describe("site public : llms.txt, le résumé destiné aux assistants IA", () => {
  const llms = read("llms.txt");
  const lines = llms.split("\n").map(normalize);

  it("commence par le nom du service et un résumé, comme le veut la convention", () => {
    expect(lines[0]).toBe(`# ${String(organization.name)}`);
    expect(lines.some((line) => line.startsWith("> "))).toBe(true);
  });

  it("donne les prix, les quantités de messages et les employés des forfaits du code", () => {
    for (const plan of plans) {
      const line = lines.find((candidate) => candidate.startsWith(`- ${plan.name} :`)) ?? "";
      expect(line, `llms.txt : forfait « ${plan.name} »`).toContain(`${amount(plan.amount)} FCFA par mois`);
      expect(line, `llms.txt : forfait « ${plan.name} »`).toContain(`${amount(plan.messages)} messages`);
      if (plan.features.teamMembers > 0) expect(line, `llms.txt : forfait « ${plan.name} »`).toContain(`${plan.features.teamMembers} employés`);
    }
    expect(normalize(llms)).toContain(`${TRIAL.messages} messages offerts`);
  });

  it("donne le numéro de la page d'accueil, la même ville et le même éditeur", () => {
    const address = (organization.address ?? {}) as Record<string, string>;
    expect(llms.replace(/\s/g, "")).toContain(phone);
    expect(llms).toContain(String(address.addressLocality));
    expect(llms).toContain(String(organization.legalName));
  });

  it("ne renvoie que vers des pages de ce site qui existent, dont toutes les pages publiques", () => {
    const links = llms.match(/https:\/\/[^\s)]+/g) ?? [];
    for (const link of links) {
      expect(link.startsWith(`${ORIGIN}/`), `llms.txt : ${link} n'est pas une adresse du site`).toBe(true);
      expect(existsSync(fileBehind(link)), `llms.txt : ${link} ne correspond à aucun fichier`).toBe(true);
    }
    for (const page of PUBLIC_PAGES) expect(links, `llms.txt : ${page} manque dans « Pages utiles »`).toContain(addressOf(page));
  });
});
