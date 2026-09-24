import { describe, expect, it } from "vitest";
import { findBestMatchingLocation, normalizeCityName, resolveLeadQualification } from "./lead-routing.service.js";

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

  it("privilégie le quartier avant la ville quand les deux sont disponibles", () => {
    const locations = [
      {
        id: "loc-1",
        name: "Mokolo",
        city: "Yaoundé",
        responsible: [{ id: "resp-1", whatsappNumber: "+237111", active: true }],
      },
      {
        id: "loc-2",
        name: "Centre",
        city: "Yaoundé",
        responsible: [{ id: "resp-2", whatsappNumber: "+237222", active: true }],
      },
    ];

    expect(findBestMatchingLocation(locations, "Yaoundé", "Mokolo")).toMatchObject({ id: "loc-1" });
  });

  it("reporte sur le bon quartier même si la ville est absente ou imprécise", () => {
    const locations = [
      {
        id: "loc-3",
        name: "Bonaberi",
        city: "Douala",
        responsible: [{ id: "resp-3", whatsappNumber: "+237333", active: true }],
      },
    ];

    expect(findBestMatchingLocation(locations, null, "Bonaberi")).toMatchObject({ id: "loc-3" });
  });
});
