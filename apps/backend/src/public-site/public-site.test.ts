import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BILLING_PLANS, TRIAL } from "../billing/billing-plans.js";

/**
 * Le site public (apps/dashboard : page d'accueil, pages de fonctionnalités, llms.txt, plan du site) répète les mêmes
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
const PUBLIC_PAGES = ["index.html", ...pagesIn("fonctionnalites")];
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
      const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? "";
      const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1] ?? "";

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

  it("la FAQ des données structurées reprend mot pour mot les questions et les réponses affichées", () => {
    const visible = [...section(home, "questions").matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((match) => [
      visibleText(match[1] ?? ""),
      visibleText(match[2] ?? ""),
    ]);
    const marked = ((ofType(homeData, "FAQPage").mainEntity ?? []) as Array<{ name: string; acceptedAnswer: { text: string } }>).map((question) => [
      normalize(question.name),
      normalize(question.acceptedAnswer.text),
    ]);
    expect(visible.length).toBeGreaterThan(0);
    expect(marked).toEqual(visible);
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
