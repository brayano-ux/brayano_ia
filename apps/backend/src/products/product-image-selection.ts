export type ProductImageCandidate = {
  id: string;
  imageUrl: string | null;
};

export type ProductDetails = {
  name: string;
  description: string;
  category: string | null;
  price: string | null;
};

export function buildProductDetailsMessage(reply: string, product: ProductDetails) {
  const details = [
    `Produit : ${product.name}`,
    product.category ? `Catégorie : ${product.category}` : null,
    product.price ? `Prix : ${product.price}` : null,
    product.description ? `Caractéristiques : ${product.description}` : null,
  ].filter((line): line is string => Boolean(line));

  return `${reply.trim()}\n\n${details.join("\n")}`.trim();
}

export function buildProductImageCaption(product: ProductDetails) {
  return [product.name, product.price].filter(Boolean).join(" · ");
}

/** Le client demande-t-il à voir une photo ? (français et anglais, y compris « montrez », « pics », « picture »). */
export function isImageRequested(message: string): boolean {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(?:photos?|photographies?|images?|visuels?|voir|montre|montres|montrer|montrez|apercu|picture|pictures|pic|pics|show)\b/i.test(text);
}

/** Nombre maximum de photos envoyées pour une seule demande (évite d'inonder le client et de faire bloquer le numéro). */
export const MAX_PRODUCT_PHOTOS_PER_REPLY = 3;

/**
 * Photos de PRODUITS DU CATALOGUE demandées par le client, dans l'ordre choisi par l'assistant (productId d'abord,
 * puis productIds), sans doublon ni produit sans photo. Jamais une URL fournie par le modèle.
 */
export function resolveRequestedProductPhotos<T extends ProductImageCandidate>(input: {
  message: string;
  productId?: string | undefined;
  productIds?: string[] | undefined;
  products: T[];
}): Array<T & { imageUrl: string }> {
  if (!isImageRequested(input.message)) return [];
  const wanted = [input.productId, ...(input.productIds ?? [])].filter((id): id is string => Boolean(id));
  const photos: Array<T & { imageUrl: string }> = [];
  for (const id of wanted) {
    const product = input.products.find((candidate) => candidate.id === id);
    if (product?.imageUrl && !photos.some((photo) => photo.id === product.id)) photos.push(product as T & { imageUrl: string });
    if (photos.length >= MAX_PRODUCT_PHOTOS_PER_REPLY) break;
  }
  return photos;
}
