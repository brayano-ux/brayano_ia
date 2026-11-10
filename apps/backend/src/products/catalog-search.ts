/**
 * Recherche dans le catalogue pour le prompt de l'assistant. Une boutique peut avoir des centaines d'articles :
 * les envoyer tous en détail à chaque réponse coûterait cher et noierait le modèle. On envoie donc :
 *  - les fiches détaillées des articles qui correspondent à la conversation (mots du client, articles déjà montrés) ;
 *  - un index compact (nom et prix) de tout le reste, pour que l'assistant sache que ces articles existent.
 * Un petit catalogue (jusqu'à CATALOG_DETAILED_LIMIT articles) part entièrement en détail, comme avant.
 */

export const CATALOG_DETAILED_LIMIT = 30;
/** Nombre maximal d'articles actifs chargés pour une réponse (les plus récemment modifiés d'abord). */
export const CATALOG_MAX_PRODUCTS = 500;
/** Taille maximale de l'index compact dans le prompt (environ 1 500 tokens). */
export const CATALOG_INDEX_MAX_CHARS = 6_000;

export interface CatalogProduct {
  id: string;
  name: string;
  description: string;
  category: string | null;
  price: string | null;
}

export interface CatalogQuery {
  text: string;
  /** Poids du texte : le dernier message du client compte plus que le reste de la conversation. */
  weight?: number;
}

const STOPWORDS = new Set([
  "les", "des", "une", "aux", "avec", "pour", "dans", "sur", "par", "pas", "plus", "que", "qui", "quoi", "est", "sont", "avez", "vous", "nous", "votre", "vos",
  "mon", "mes", "son", "ses", "leur", "leurs", "cet", "cette", "ces", "tout", "tous", "toute", "toutes", "veux", "voudrais", "voulez", "cherche", "besoin", "bonjour",
  "bonsoir", "salut", "merci", "svp", "stp", "oui", "non", "combien", "prix", "coute", "photo", "photos", "image", "images", "voir", "montrez", "montre", "envoyez",
  "envoie", "aussi", "autre", "autres", "avoir", "faire", "comme", "bien", "tres", "the", "and", "you", "have", "for", "how", "much", "want", "need", "please", "show",
  "fcfa", "cfa", "xaf", "xof", "produit", "produits", "article", "articles", "disponible", "disponibles",
]);

/** Mots utiles d'un texte : sans accents, sans mots vides, au singulier approximatif (« chaussures » → « chaussure »). */
export function searchTokens(text: string): string[] {
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const tokens: string[] = [];
  for (const word of words) {
    if (word.length < 2) continue;
    // Un nombre court reste utile (« en 42 », « iPhone 13 »).
    if (/^\d+$/.test(word)) { tokens.push(word); continue; }
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    const stem = word.length > 3 ? word.replace(/[sx]$/, "") : word;
    if (!STOPWORDS.has(stem)) tokens.push(stem);
  }
  return tokens;
}

function matches(queryToken: string, productToken: string): boolean {
  if (queryToken === productToken) return true;
  // « chaussur » retrouve « chaussure », « robe » ne retrouve pas « robinet ».
  if (queryToken.length < 5 || productToken.length < 5) return false;
  return productToken.startsWith(queryToken) || queryToken.startsWith(productToken);
}

/** Pertinence d'un article pour les textes donnés : le nom pèse plus que la catégorie, qui pèse plus que la description. */
export function scoreProduct(product: CatalogProduct, queries: Array<{ tokens: string[]; weight: number }>): number {
  const fields: Array<{ tokens: string[]; weight: number }> = [
    { tokens: searchTokens(product.name), weight: 3 },
    { tokens: searchTokens(product.category ?? ""), weight: 2 },
    { tokens: searchTokens(product.description.slice(0, 600)), weight: 1 },
  ];
  let score = 0;
  for (const query of queries) {
    for (const queryToken of new Set(query.tokens)) {
      let best = 0;
      for (const field of fields) {
        if (field.weight > best && field.tokens.some((token) => matches(queryToken, token))) best = field.weight;
      }
      score += best * query.weight;
    }
  }
  return score;
}

/**
 * Choisit les articles dont la fiche complète part dans le prompt. Ordre de priorité : les articles déjà en jeu
 * dans la conversation (`pinnedIds`), puis les plus pertinents pour les textes donnés, puis les plus récents pour
 * compléter. L'ordre d'entrée (plus récemment modifiés d'abord) départage les ex æquo.
 */
export function selectCatalogForPrompt<T extends CatalogProduct>(
  products: T[],
  input: { queries?: CatalogQuery[]; pinnedIds?: Array<string | null | undefined>; limit?: number } = {},
): { detailed: T[]; others: T[] } {
  const limit = input.limit ?? CATALOG_DETAILED_LIMIT;
  if (products.length <= limit) return { detailed: products, others: [] };

  const queries = (input.queries ?? [])
    .map((query) => ({ tokens: searchTokens(query.text), weight: query.weight ?? 1 }))
    .filter((query) => query.tokens.length);
  const pinned = new Set((input.pinnedIds ?? []).filter((id): id is string => Boolean(id)));

  const ranked = products
    .map((product, index) => ({ product, index, pinned: pinned.has(product.id), score: queries.length ? scoreProduct(product, queries) : 0 }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score || a.index - b.index);

  const detailed = ranked.slice(0, limit).map((entry) => entry.product);
  const kept = new Set(detailed.map((product) => product.id));
  return { detailed, others: products.filter((product) => !kept.has(product.id)) };
}

/** Index compact des articles sans fiche détaillée : « Catégorie : Nom (prix) ; Nom (prix) ». Null s'il n'y en a pas. */
export function buildCatalogIndexSection(others: CatalogProduct[], maxChars = CATALOG_INDEX_MAX_CHARS): string | null {
  if (!others.length) return null;
  const byCategory = new Map<string, string[]>();
  for (const product of others) {
    const category = product.category?.trim() || "Divers";
    const label = product.price?.trim() ? `${product.name.trim()} (${product.price.trim()})` : product.name.trim();
    byCategory.set(category, [...(byCategory.get(category) ?? []), label]);
  }

  const lines: string[] = [];
  let used = 0;
  let listed = 0;
  for (const [category, labels] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"))) {
    const kept: string[] = [];
    for (const label of labels) {
      const cost = label.length + 3;
      if (used + cost > maxChars) break;
      kept.push(label);
      used += cost;
    }
    if (kept.length) {
      lines.push(`- ${category} : ${kept.join(" ; ")}`);
      listed += kept.length;
      used += category.length + 5;
    }
    if (used >= maxChars) break;
  }
  const hidden = others.length - listed;

  return `
AUTRES ARTICLES DU CATALOGUE (nom et prix seulement)

Le catalogue compte aussi ${others.length} autre${others.length > 1 ? "s" : ""} article${others.length > 1 ? "s" : ""}. Les fiches détaillées ci-dessus sont celles qui correspondent le mieux à la conversation.
Si le client cherche un article de cette liste : confirme qu'il existe et donne son prix exact, sans inventer de description ni de caractéristiques. Laisse productId et discussedProductId vides pour cet article : sa fiche complète (identifiant, description, photo) te sera fournie dès le message suivant. Ne dis jamais qu'un article de cette liste n'existe pas.

${lines.join("\n")}${hidden > 0 ? `\n… et ${hidden} autre${hidden > 1 ? "s" : ""} article${hidden > 1 ? "s" : ""} : si le client cherche autre chose, demande-lui de préciser le nom ou la catégorie.` : ""}
`.trim();
}
