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

  it("renvoie null quand aucun montant n'est exploitable", () => {
    expect(parsePriceAmount(null)).toBeNull();
    expect(parsePriceAmount(undefined)).toBeNull();
    expect(parsePriceAmount("")).toBeNull();
    expect(parsePriceAmount("Sur devis")).toBeNull();
    expect(parsePriceAmount("Gratuit")).toBeNull();
    expect(parsePriceAmount("0 FCFA")).toBeNull();
  });
});
