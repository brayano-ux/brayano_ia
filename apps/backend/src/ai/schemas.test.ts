import { describe, expect, it } from "vitest";
import { aiReplySchema } from "./schemas.js";

const baseReply = {
  reply: "Bonjour",
  intent: "demande_information",
  confidence: 0.8,
  needsHuman: false,
  leadScore: 10,
  qualificationStatus: "not_qualified",
  nextAction: "continue",
  leadData: {},
};

describe("aiReplySchema : discussedProductId (article en discussion)", () => {
  it("accepte un identifiant de produit, une chaîne vide ou l'absence du champ", () => {
    const id = "3f4a8c1e-2b7d-4e0a-9c6f-1d2e3f4a5b6c";
    expect(aiReplySchema.safeParse({ ...baseReply, discussedProductId: id }).success).toBe(true);
    expect(aiReplySchema.safeParse({ ...baseReply, discussedProductId: "" }).success).toBe(true);
    expect(aiReplySchema.safeParse(baseReply).success).toBe(true);
  });

  it("ignore une valeur invalide écrite par le modèle au lieu de rejeter toute la réponse", () => {
    const parsed = aiReplySchema.safeParse({ ...baseReply, discussedProductId: "aucun" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.discussedProductId).toBe("");
  });
});

describe("aiReplySchema : onTopic (sujet autorisé)", () => {
  it("accepte un vrai booléen JSON", () => {
    expect(aiReplySchema.safeParse({ ...baseReply, onTopic: true }).success).toBe(true);
    expect(aiReplySchema.safeParse({ ...baseReply, onTopic: false }).success).toBe(true);
  });

  it("accepte \"true\"/\"false\" écrits en texte par le modèle, sans faire échouer toute la réponse", () => {
    const asTrue = aiReplySchema.safeParse({ ...baseReply, onTopic: "true" });
    expect(asTrue.success).toBe(true);
    expect(asTrue.success && asTrue.data.onTopic).toBe(true);

    const asFalse = aiReplySchema.safeParse({ ...baseReply, onTopic: "False" });
    expect(asFalse.success).toBe(true);
    expect(asFalse.success && asFalse.data.onTopic).toBe(false);
  });

  it("reste absent quand le filtre n'est pas actif (le modèle ne le renvoie pas)", () => {
    const parsed = aiReplySchema.safeParse(baseReply);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.onTopic).toBeUndefined();
  });
});
