import { describe, expect, it } from "vitest";
import {
  buildProductDetailsMessage,
  buildProductImageCaption,
  isImageRequested,
  resolveRequestedProductImage,
  resolveRequestedProductPhotos,
} from "./product-image-selection.js";

const selectedImageUrl = "https://api.example.com/media/products/org/selected.jpg";
const catalog = [
  { id: "selected", imageUrl: selectedImageUrl },
  { id: "without-image", imageUrl: null },
];

describe("requested product image selection", () => {
  it("returns the stored image for the selected catalog product after an image request", () => {
    expect(resolveRequestedProductImage({
      message: "Peux-tu m’envoyer la photo de ce produit ?",
      productId: "selected",
      products: catalog,
    })).toBe(selectedImageUrl);
  });

  it("does not send a model-provided URL or an image the prospect did not request", () => {
    expect(resolveRequestedProductImage({
      message: "Ce produit coûte combien ?",
      productId: "selected",
      products: catalog,
      legacyImageUrl: "https://attacker.example/image.jpg",
      configuredLegacyImageUrl: "https://api.example.com/agent.png",
    })).toBeNull();
    expect(resolveRequestedProductImage({
      message: "Je voudrais voir le produit.",
      productId: "selected",
      products: catalog,
      legacyImageUrl: "https://attacker.example/image.jpg",
      configuredLegacyImageUrl: "https://api.example.com/agent.png",
    })).toBe(selectedImageUrl);
  });

  it("does not substitute an unrelated agent image for a missing product image", () => {
    expect(resolveRequestedProductImage({
      message: "Montre-moi une image du produit.",
      productId: "without-image",
      products: catalog,
      legacyImageUrl: "https://api.example.com/agent.png",
      configuredLegacyImageUrl: "https://api.example.com/agent.png",
    })).toBeNull();
  });
});

describe("product information sent with product images", () => {
  const product = {
    name: "Sandalette Confort",
    description: "Semelle antidérapante, bride réglable et disponible en plusieurs pointures.",
    category: "Chaussures",
    price: "12 500 FCFA",
  };

  it("adds stored product characteristics and commercial facts to the WhatsApp text", () => {
    const message = buildProductDetailsMessage("Voici le modèle demandé.", product);

    expect(message).toContain("Voici le modèle demandé.");
    expect(message).toContain("Produit : Sandalette Confort");
    expect(message).toContain("Catégorie : Chaussures");
    expect(message).toContain("Prix : 12 500 FCFA");
    expect(message).toContain(product.description);
  });

  it("keeps the image caption short while naming the selected product", () => {
    expect(buildProductImageCaption(product)).toBe("Sandalette Confort · 12 500 FCFA");
  });
});

describe("isImageRequested", () => {
  it.each(["Envoyez-moi la photo", "Vous avez des photos ?", "Montrez-moi la robe", "montre moi le modèle", "Je voudrais voir", "Send me a picture", "show me", "des pics ?", "un aperçu svp", "Quelle est l'image du produit ?"])("reconnaît « %s »", (text) => {
    expect(isImageRequested(text)).toBe(true);
  });

  it.each(["Combien coûte la robe ?", "Je veux commander", "Vous êtes où ?", "Bonjour"])("ne confond pas « %s » avec une demande de photo", (text) => {
    expect(isImageRequested(text)).toBe(false);
  });
});

describe("resolveRequestedProductPhotos", () => {
  const products = [
    { id: "a", imageUrl: "https://api.example.com/a.jpg" },
    { id: "b", imageUrl: "https://api.example.com/b.jpg" },
    { id: "c", imageUrl: null },
    { id: "d", imageUrl: "https://api.example.com/d.jpg" },
    { id: "e", imageUrl: "https://api.example.com/e.jpg" },
  ];

  it("renvoie les photos des produits choisis, sans doublon, dans l'ordre", () => {
    const photos = resolveRequestedProductPhotos({ message: "Envoyez-moi les photos", productId: "b", productIds: ["a", "b"], products });
    expect(photos.map((photo) => photo.id)).toEqual(["b", "a"]);
  });

  it("ignore un produit sans photo, un identifiant inconnu et une URL inventée", () => {
    const photos = resolveRequestedProductPhotos({ message: "Je voudrais voir", productIds: ["c", "zzz", "https://attacker.example/x.jpg", "d"], products });
    expect(photos.map((photo) => photo.id)).toEqual(["d"]);
  });

  it("limite à 3 photos par réponse", () => {
    const photos = resolveRequestedProductPhotos({ message: "Montrez-moi tout", productIds: ["a", "b", "d", "e"], products });
    expect(photos).toHaveLength(3);
  });

  it("n'envoie aucune photo si le client n'en a pas demandé", () => {
    expect(resolveRequestedProductPhotos({ message: "Combien ça coûte ?", productId: "a", productIds: ["b"], products })).toEqual([]);
  });
});
