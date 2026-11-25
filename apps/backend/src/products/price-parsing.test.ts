import { describe, expect, it } from "vitest";
import { parsePriceAmount } from "./price-parsing.js";

describe("parsePriceAmount", () => {
  it("extrait un montant numérique depuis un prix libre", () => {
    expect(parsePriceAmount("25 000 FCFA")).toBe(25000);
    expect(parsePriceAmount("25000")).toBe(25000);
    expect(parsePriceAmount("Prix : 7.500 FCFA")).toBe(7500);
    expect(parsePriceAmount("1,200 FCFA")).toBe(1200);
    expect(parsePriceAmount("À partir de 3000 FCFA")).toBe(3000);
  });

  it("ne devine pas quand le texte contient plusieurs nombres : la négociation est alors désactivée pour l'article", () => {
    // Lire « 2 » dans « Lot de 2 : 5 000 FCFA » ferait calculer une offre proche de zéro.
    for (const text of ["Lot de 2 : 5 000 FCFA", "2 pour 5000 FCFA", "5 000 à 7 000 FCFA", "5000 - 7000", "1,5 L : 2 000 FCFA", "25 000 FCFA (taille 42)"]) {
      expect(parsePriceAmount(text), text).toBeNull();
    }
  });

  it("lit les milliers séparés par une espace insécable", () => {
    expect(parsePriceAmount("25\u00a0000 FCFA")).toBe(25000);
    expect(parsePriceAmount("25\u202f000 FCFA")).toBe(25000);
    expect(parsePriceAmount("15 000 FCFA la paire")).toBe(15000);
  });

  it("renvoie null quand aucun montant n'est exploitable", () => {
    expect(parsePriceAmount(null)).toBeNull();
    expect(parsePriceAmount(undefined)).toBeNull();
    expect(parsePriceAmount("")).toBeNull();
    expect(parsePriceAmount("Sur devis")).toBeNull();
    expect(parsePriceAmount("Gratuit")).toBeNull();
    expect(parsePriceAmount("0 FCFA")).toBeNull();
  });
});
