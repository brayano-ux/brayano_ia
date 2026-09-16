import { describe, expect, it } from "vitest";
import { normalizeCityName, resolveLeadQualification } from "./lead-routing.service.js";

describe("lead routing service", () => {
  it("normalise correctement les villes et les variantes", () => {
    expect(normalizeCityName("DOUALA")).toBe("douala");
    expect(normalizeCityName("Yaoundé")).toBe("yaounde");
    expect(normalizeCityName("je suis à Douala Cameroun")).toBe("douala");
  });

  it("considère un lead comme suffisamment qualifié avec nom + ville + besoin", () => {
    const lead = {
      name: "Jean",
      city: "Yaoundé",
      need: "Produit X",
      budget: "150000 FCFA",
    };

    expect(resolveLeadQualification(lead)).toMatchObject({ isQualified: true, minimumScore: 70 });
  });

  it("n’autorise pas une qualification sans ville ni besoin", () => {
    const lead = {
      name: "Jean",
    };

    expect(resolveLeadQualification(lead).isQualified).toBe(false);
  });
});
