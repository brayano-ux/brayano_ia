import { describe, expect, it } from "vitest";
import {
  buildCorrectionsPrompt, buildExamplesPrompt, pickExamples, pickRelevantCorrections, redactPersonalData, similarity, tokenize,
} from "./memory.js";

describe("tokenize / similarity", () => {
  it("ignore les mots vides, les accents et le pluriel", () => {
    expect([...tokenize("Vous livrez à Bonamoussadi ?")]).toEqual(["livrez", "bonamoussadi"]);
    expect(tokenize("Les robes rouges")).toEqual(tokenize("robe rouge"));
  });

  it("mesure la ressemblance entre deux demandes", () => {
    expect(similarity(tokenize("Vous livrez à Bonamoussadi ?"), tokenize("livraison bonamoussadi possible"))).toBeGreaterThan(0.3);
    expect(similarity(tokenize("Combien coûte la robe ?"), tokenize("Vous ouvrez le samedi ?"))).toBe(0);
    expect(similarity(new Set(), tokenize("robe"))).toBe(0);
  });
});

describe("redactPersonalData", () => {
  it("masque les numéros et les emails sans toucher aux petits nombres", () => {
    expect(redactPersonalData("Appelez le 6 55 00 00 01 ou +237 655 000 001, mail amina@example.com, 5 000 FCFA")).toBe(
      "Appelez le [numéro] ou [numéro], mail [email], 5 000 FCFA",
    );
  });
});

describe("corrections du propriétaire", () => {
  const corrections = [
    { id: "1", question: "Vous livrez à Bonamoussadi ?", correctReply: "Oui, livraison à Bonamoussadi sous 24 h pour 1 000 FCFA." },
    { id: "2", question: "C'est quoi vos horaires ?", correctReply: "Du lundi au samedi, de 8 h à 18 h." },
    { id: "3", question: "", correctReply: "Toujours vouvoyer le client." },
  ];

  it("garde les règles générales et les corrections qui ressemblent au message", () => {
    const picked = pickRelevantCorrections(corrections, "Est-ce que vous livrez à Bonamoussadi ?");
    expect(picked.map((entry) => entry.id)).toEqual(["3", "1"]);
  });

  it("n'ajoute pas de correction sans rapport avec le message", () => {
    expect(pickRelevantCorrections(corrections, "Je cherche une robe rouge").map((entry) => entry.id)).toEqual(["3"]);
  });

  it("écrit une section de prompt claire, ou rien", () => {
    expect(buildCorrectionsPrompt([])).toBeNull();
    const prompt = buildCorrectionsPrompt(corrections.slice(0, 1).concat(corrections.slice(2)))!;
    expect(prompt).toContain("CORRECTIONS DU PROPRIÉTAIRE");
    expect(prompt).toContain("livraison à Bonamoussadi sous 24 h");
    expect(prompt).toContain("Règle de l'entreprise : Toujours vouvoyer le client.");
  });
});

describe("exemples d'échanges réussis", () => {
  const candidates = [
    { customer: "Je voudrais une coupe pour samedi matin", reply: "Bien sûr ! J'ai de la place samedi à 9 h ou 10 h, quel horaire vous convient ?" },
    { customer: "Vous faites les tresses africaines ?", reply: "Oui, à partir de 8 000 FCFA. Voulez-vous réserver un créneau ?" },
    { customer: "Vous faites les tresses africaines ?", reply: "Oui, à partir de 8 000 FCFA. Voulez-vous réserver un créneau ?" },
    { customer: "Quelle heure ?", reply: "OK" },
  ];

  it("retrouve les échanges qui ressemblent, sans doublon", () => {
    const picked = pickExamples(candidates, "Est-ce que vous faites des tresses ?");
    expect(picked).toHaveLength(1);
    expect(picked[0]?.reply).toContain("8 000 FCFA");
  });

  it("ne renvoie rien quand rien ne ressemble", () => {
    expect(pickExamples(candidates, "Où êtes-vous situés ?")).toEqual([]);
  });

  it("anonymise les exemples dans le prompt", () => {
    const prompt = buildExamplesPrompt([{ customer: "Mon numéro 655 00 00 01", reply: "Merci, je note le 655 00 00 01 pour la réservation de samedi." }])!;
    expect(prompt).toContain("EXEMPLES D'ÉCHANGES RÉUSSIS");
    expect(prompt).not.toContain("655 00 00 01");
    expect(prompt).toContain("[numéro]");
    expect(buildExamplesPrompt([])).toBeNull();
  });
});
