import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt.js";
import { aiReplySchema } from "./schemas.js";

const baseSettings = {
  agentName: "Assistant",
  businessInfo: null,
  systemPrompt: "Réponds de manière utile.",
};

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
