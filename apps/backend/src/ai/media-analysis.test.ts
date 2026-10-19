import { describe, expect, it } from "vitest";
import { classifyByCaption, describeMediaKindLabel, parseMediaAnalysis } from "./media-analysis.js";

describe("parseMediaAnalysis", () => {
  it("lit une réponse valide", () => {
    expect(parseMediaAnalysis('{"kind":"payment_proof","summary":"Transfert Orange Money de 15 000 FCFA"}')).toEqual({
      kind: "payment_proof",
      summary: "Transfert Orange Money de 15 000 FCFA",
    });
  });

  it("accepte un bloc de code et ramène un type inconnu à « other »", () => {
    expect(parseMediaAnalysis('```json\n{"kind":"selfie","summary":"Un visage"}\n```')).toEqual({ kind: "other", summary: "Un visage" });
  });

  it("refuse une réponse qui n'est pas du JSON", () => {
    expect(parseMediaAnalysis("Voici mon analyse")).toBeNull();
  });

  it("raccourcit un résumé trop long", () => {
    expect(parseMediaAnalysis(JSON.stringify({ kind: "other", summary: "a".repeat(500) }))?.summary).toHaveLength(240);
  });
});

describe("classifyByCaption", () => {
  it("repère un probable paiement dans la légende", () => {
    expect(classifyByCaption("Voilà le paiement Orange Money", false)).toBe("payment_proof");
    expect(classifyByCaption("reçu momo", false)).toBe("payment_proof");
    expect(classifyByCaption("Voilà mon transfert", false)).toBe("payment_proof");
  });

  it("ne suppose rien sans indice", () => {
    expect(classifyByCaption(null, false)).toBe("other");
    expect(classifyByCaption("", true)).toBe("document");
    expect(classifyByCaption("Regardez cette robe", false)).toBe("other");
  });
});

describe("describeMediaKindLabel", () => {
  it("décrit sans affirmer que c'est un paiement", () => {
    expect(describeMediaKindLabel("payment_proof", false)).toContain("ressemble");
    expect(describeMediaKindLabel("other", true)).toBe("un document");
  });
});
