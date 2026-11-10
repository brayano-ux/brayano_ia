import { describe, expect, it } from "vitest";
import { buildCatalogIndexSection, CATALOG_DETAILED_LIMIT, searchTokens, selectCatalogForPrompt, type CatalogProduct } from "./catalog-search.js";

const product = (id: string, name: string, extra: Partial<CatalogProduct> = {}): CatalogProduct => ({ id, name, description: "", category: null, price: null, ...extra });
/** 40 articles sans rapport, du plus récent au plus ancien, comme les renvoie la base. */
const filler = (count = 40) => Array.from({ length: count }, (_value, index) => product(`filler-${index}`, `Casserole inox ${index}`, { category: "Cuisine", price: "4 000 FCFA" }));

describe("searchTokens", () => {
  it("retire accents, mots vides et pluriels", () => {
    expect(searchTokens("Bonjour, vous avez des Chaussures élégantes ?")).toEqual(["chaussure", "elegante"]);
    expect(searchTokens("les robes")).toEqual(["robe"]);
  });

  it("garde les nombres utiles (pointure, modèle)", () => {
    expect(searchTokens("iPhone 13 en 42")).toEqual(["iphone", "13", "42"]);
  });
});

describe("selectCatalogForPrompt", () => {
  it("envoie tout le catalogue en détail quand il est petit", () => {
    const products = filler(CATALOG_DETAILED_LIMIT);
    const { detailed, others } = selectCatalogForPrompt(products, { queries: [{ text: "une robe" }] });
    expect(detailed).toHaveLength(CATALOG_DETAILED_LIMIT);
    expect(others).toEqual([]);
  });

  it("retrouve un article ancien d'un grand catalogue d'après les mots du client", () => {
    const sandals = product("sandals", "Sandales cuir marron", { category: "Chaussures" });
    const products = [...filler(), sandals];
    const { detailed, others } = selectCatalogForPrompt(products, { queries: [{ text: "Vous avez des sandales en cuir ?", weight: 3 }] });
    expect(detailed[0]?.id).toBe("sandals");
    expect(detailed).toHaveLength(CATALOG_DETAILED_LIMIT);
    expect(others).toHaveLength(products.length - CATALOG_DETAILED_LIMIT);
    expect(others.some((item) => item.id === "sandals")).toBe(false);
  });

  it("classe le nom avant la catégorie, et la catégorie avant la description", () => {
    const byName = product("name", "Robe wax");
    const byCategory = product("category", "Ensemble pagne", { category: "Robes" });
    const byDescription = product("description", "Tenue de soirée", { description: "Une robe longue en satin." });
    const { detailed } = selectCatalogForPrompt([...filler(), byDescription, byCategory, byName], { queries: [{ text: "je cherche une robe" }] });
    expect(detailed.slice(0, 3).map((item) => item.id)).toEqual(["name", "category", "description"]);
  });

  it("garde toujours les articles déjà en jeu dans la conversation", () => {
    const pinned = product("pinned", "Montre dorée");
    const { detailed } = selectCatalogForPrompt([...filler(), pinned], { queries: [{ text: "et la livraison ?" }], pinnedIds: ["pinned", null, undefined] });
    expect(detailed[0]?.id).toBe("pinned");
  });

  it("sans mot utile, complète avec les articles les plus récents", () => {
    const products = filler();
    const { detailed } = selectCatalogForPrompt(products, { queries: [{ text: "Bonjour" }] });
    expect(detailed.map((item) => item.id)).toEqual(products.slice(0, CATALOG_DETAILED_LIMIT).map((item) => item.id));
  });

  it("ne confond pas des mots courts qui se ressemblent", () => {
    const tap = product("tap", "Robinet cuisine");
    const { detailed } = selectCatalogForPrompt([...filler(), tap], { queries: [{ text: "une robe" }] });
    expect(detailed.some((item) => item.id === "tap")).toBe(false);
  });
});

describe("buildCatalogIndexSection", () => {
  it("renvoie null quand tout le catalogue est déjà détaillé", () => {
    expect(buildCatalogIndexSection([])).toBeNull();
  });

  it("liste nom et prix par catégorie, sans identifiant ni description", () => {
    const section = buildCatalogIndexSection([
      product("a", "Sandales cuir", { category: "Chaussures", price: "12 000 FCFA", description: "secret" }),
      product("b", "Baskets blanches", { category: "Chaussures" }),
      product("c", "Sac à main"),
    ])!;
    expect(section).toContain("3 autres articles");
    expect(section).toContain("- Chaussures : Sandales cuir (12 000 FCFA) ; Baskets blanches");
    expect(section).toContain("- Divers : Sac à main");
    expect(section).not.toContain("secret");
    expect(section).not.toContain('"a"');
  });

  it("tronque un très grand catalogue et le dit", () => {
    const many = Array.from({ length: 200 }, (_value, index) => product(`p${index}`, `Article numéro ${index}`, { price: "1 000 FCFA" }));
    const section = buildCatalogIndexSection(many, 600)!;
    expect(section.length).toBeLessThan(1_800);
    expect(section).toMatch(/… et \d+ autres articles/);
  });
});
