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

describe("aiReplySchema : tolérance aux écarts de format du modèle", () => {
  it("convertit les nombres écrits en texte et ramène les valeurs hors bornes dans l'intervalle", () => {
    const parsed = aiReplySchema.safeParse({ ...baseReply, leadScore: "80", confidence: "0,9" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.leadScore).toBe(80);
    expect(parsed.success && parsed.data.confidence).toBeCloseTo(0.9);
    const clamped = aiReplySchema.safeParse({ ...baseReply, leadScore: 140, confidence: -1 });
    expect(clamped.success && clamped.data.leadScore).toBe(100);
    expect(clamped.success && clamped.data.confidence).toBe(0);
  });

  it("accepte une énumération mal écrite et remplace une valeur inconnue par la valeur sûre", () => {
    const parsed = aiReplySchema.safeParse({ ...baseReply, qualificationStatus: "Qualified", nextAction: "HANDOFF", needsHuman: "true" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.qualificationStatus).toBe("qualified");
    expect(parsed.success && parsed.data.nextAction).toBe("handoff");
    const unknown = aiReplySchema.safeParse({ ...baseReply, qualificationStatus: "peut-être", nextAction: "wait", intent: "" });
    expect(unknown.success).toBe(true);
    expect(unknown.success && unknown.data.qualificationStatus).toBe("not_qualified");
    expect(unknown.success && unknown.data.nextAction).toBe("continue");
    expect(unknown.success && unknown.data.intent).toBe("demande_information");
  });

  it("ignore un productId qui n'est pas un identifiant du catalogue au lieu de rejeter la réponse", () => {
    const parsed = aiReplySchema.safeParse({ ...baseReply, productId: "Robe wax", leadData: "aucune" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.productId).toBe("");
    expect(parsed.success && parsed.data.leadData).toEqual({});
  });

  it("refuse seulement une réponse sans texte pour le client", () => {
    expect(aiReplySchema.safeParse({ ...baseReply, reply: "   " }).success).toBe(false);
  });
});

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
