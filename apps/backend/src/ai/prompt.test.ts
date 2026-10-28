import { describe, expect, it } from "vitest";
import { buildNegotiationSection, buildQuotedProductSection, buildSystemPrompt, buildTopicGateSection } from "./prompt.js";
import { aiReplySchema } from "./schemas.js";

const baseSettings = {
  agentName: "Assistant",
  businessInfo: null,
  systemPrompt: "Réponds de manière utile.",
};

describe("sujet autorisé dans le prompt", () => {
  it("n'apparaît pas quand aucune section n'est fournie", () => {
    const prompt = buildSystemPrompt({ ...baseSettings });
    expect(prompt).not.toContain("SUJET AUTORISÉ");
  });

  it("insère le sujet configuré et demande une classification tranchée", () => {
    const prompt = buildSystemPrompt({ ...baseSettings, topicGateSection: buildTopicGateSection("nos vêtements") });
    expect(prompt).toContain("SUJET AUTORISÉ");
    expect(prompt).toContain('"nos vêtements"');
    expect(prompt).toContain("onTopic");
  });
});

describe("négociation de prix dans le prompt", () => {
  it("n'apparaît pas quand aucune section n'est fournie", () => {
    const prompt = buildSystemPrompt({ ...baseSettings });
    expect(prompt).not.toContain("NÉGOCIATION DE PRIX");
    expect(prompt).not.toContain("wantsDiscount");
  });

  it("demande de signaler la demande de remise sans jamais proposer de prix soi-même", () => {
    const prompt = buildSystemPrompt({ ...baseSettings, negotiationSection: buildNegotiationSection() });
    expect(prompt).toContain("NÉGOCIATION DE PRIX");
    expect(prompt).toContain("wantsDiscount");
  });
});

describe("photo citée par le client dans le prompt", () => {
  it("n'apparaît pas quand le client ne répond à aucune photo", () => {
    const prompt = buildSystemPrompt({ ...baseSettings });
    expect(prompt).not.toContain("PHOTO SÉLECTIONNÉE PAR LE CLIENT");
  });

  it("précise de quel produit il s'agit quand le client répond à sa photo", () => {
    const prompt = buildSystemPrompt({
      ...baseSettings,
      quotedProductSection: buildQuotedProductSection({ name: "Robe rouge", price: "12 000 FCFA", category: "Vêtements" }),
    });
    expect(prompt).toContain("PHOTO SÉLECTIONNÉE PAR LE CLIENT");
    expect(prompt).toContain("Robe rouge");
    expect(prompt).toContain("12 000 FCFA");
  });
});

describe("product catalog in the assistant prompt", () => {
  it("provides product facts and an image flag without exposing the media URL", () => {
    const product = {
      id: "191e4567-e89b-42d3-a456-426614174000",
      name: "Chaise ergonomique",
      description: "Chaise réglable avec soutien lombaire.",
      category: "Mobilier",
      price: "45 000 FCFA",
      imageUrl: "http://localhost:3000/media/products/org/chaise.jpg",
    };

    const prompt = buildSystemPrompt({ ...baseSettings, products: [product] });

    expect(prompt).toContain(product.id);
    expect(prompt).toContain(product.name);
    expect(prompt).toContain('"hasImage":true');
    expect(prompt).not.toContain(product.imageUrl);
  });

  it("accepts only a UUID-shaped product selection in the AI response", () => {
    const reply = {
      reply: "Voici le produit qui correspond.",
      intent: "demande_information",
      confidence: 0.9,
      needsHuman: false,
      leadScore: 0,
      qualificationStatus: "not_qualified",
      nextAction: "continue",
      leadData: {},
      productId: "191e4567-e89b-42d3-a456-426614174000",
    };

    expect(aiReplySchema.safeParse(reply).success).toBe(true);
    expect(aiReplySchema.safeParse({ ...reply, productId: "https://example.com/image.jpg" }).success).toBe(false);
  });
});

describe("agenda section in the assistant prompt", () => {
  it("leaves the prompt untouched when the agenda is disabled", () => {
    const without = buildSystemPrompt({ ...baseSettings, products: [] });
    expect(without).not.toContain("PRISE DE RENDEZ-VOUS");
    expect(without).not.toContain("booking");
    expect(buildSystemPrompt({ ...baseSettings, products: [], agenda: null })).toBe(without);
  });

  it("injects free slots and the booking field when the agenda is enabled", () => {
    const prompt = buildSystemPrompt({ ...baseSettings, products: [], agenda: "PRISE DE RENDEZ-VOUS (AGENDA ACTIVÉ)\n- 2026-10-13 : 09:00–12:00" });
    expect(prompt).toContain("2026-10-13 : 09:00–12:00");
    expect(prompt).toContain("- booking :");
  });
});

describe("language handling in the assistant prompt", () => {
  const prompt = buildSystemPrompt({ ...baseSettings, products: [] });

  it("replies in the prospect's language, including English and pidgin", () => {
    expect(prompt).toContain("LANGUE DE RÉPONSE");
    expect(prompt).toMatch(/anglais/i);
    expect(prompt).toMatch(/pidgin/i);
    expect(prompt).toContain("abeg");
  });

  it("no longer forces French-only replies", () => {
    expect(prompt).not.toContain("Réponds en français, sauf si");
  });

  it("keeps the JSON contract", () => {
    expect(prompt).toContain("leadData");
  });
});

describe("orders section in the assistant prompt", () => {
  it("leaves the prompt untouched when orders are disabled", () => {
    const without = buildSystemPrompt({ ...baseSettings, products: [] });
    expect(without).not.toContain("PRISE DE COMMANDE");
    expect(buildSystemPrompt({ ...baseSettings, products: [], orders: null })).toBe(without);
  });

  it("adds the order rules and the order field when enabled", () => {
    const prompt = buildSystemPrompt({ ...baseSettings, products: [], orders: "PRISE DE COMMANDE (ACTIVÉE)" });
    expect(prompt).toContain("PRISE DE COMMANDE (ACTIVÉE)");
    expect(prompt).toContain("- order :");
  });
});

describe("sections added by the product improvements", () => {
  it("adds nothing optional when nothing is provided", () => {
    const prompt = buildSystemPrompt({ ...baseSettings, products: [] });
    expect(prompt).not.toContain("HORAIRES D'OUVERTURE");
    expect(prompt).not.toContain("CORRECTIONS DU PROPRIÉTAIRE");
    expect(prompt).not.toContain("EXEMPLES D'ÉCHANGES RÉUSSIS");
    expect(prompt).not.toContain("MESSAGE D'ACCUEIL DÉJÀ ENVOYÉ");
  });

  it("always forbids confirming a payment from a photo", () => {
    const prompt = buildSystemPrompt({ ...baseSettings, products: [] });
    expect(prompt).toContain("PHOTOS ET DOCUMENTS REÇUS");
    expect(prompt).toContain("Ne confirme JAMAIS un paiement");
  });

  it("places the owner's corrections after the company's instructions", () => {
    const prompt = buildSystemPrompt({
      ...baseSettings,
      products: [],
      hoursSection: "HORAIRES D'OUVERTURE\n\nL'entreprise est FERMÉE.",
      correctionsSection: "CORRECTIONS DU PROPRIÉTAIRE (PRIORITAIRES)\n- Règle de l'entreprise : vouvoyer.",
      examplesSection: "EXEMPLES D'ÉCHANGES RÉUSSIS DE CETTE ENTREPRISE\n\nExemple 1",
      welcomeSent: true,
    });
    expect(prompt).toContain("L'entreprise est FERMÉE.");
    expect(prompt.indexOf("INSTRUCTIONS SPÉCIFIQUES")).toBeLessThan(prompt.indexOf("CORRECTIONS DU PROPRIÉTAIRE"));
    expect(prompt).toContain("MESSAGE D'ACCUEIL DÉJÀ ENVOYÉ");
    expect(prompt).toContain("Exemple 1");
  });
});


describe("extended business information", () => {
  it("includes the entire 50,000-character company description in the AI context", () => {
    const ending = "CONDITIONS FINALES À RESPECTER.";
    const businessInfo = "Informations et tarifs.\n".repeat(2_200).slice(0, 50_000 - ending.length) + ending;
    const prompt = buildSystemPrompt({ ...baseSettings, businessInfo });
    expect(businessInfo).toHaveLength(50_000);
    expect(prompt).toContain(businessInfo);
    expect(prompt).toContain("CONDITIONS FINALES À RESPECTER.");
  });
});
