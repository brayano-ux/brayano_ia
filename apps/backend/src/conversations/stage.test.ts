import { describe, expect, it } from "vitest";
import { computeAutoStage, stagePriority } from "./stage.js";

describe("computeAutoStage", () => {
  it("garde « Nouveau » pour une simple salutation", () => {
    expect(computeAutoStage("NEW", false, { intent: "salutation", qualificationStatus: "NOT_QUALIFIED", leadScore: 5 })).toBe("NEW");
  });

  it("passe à « Intéressé » après une demande de prix", () => {
    expect(computeAutoStage("NEW", false, { intent: "demande_prix" })).toBe("INTERESTED");
  });

  it("passe à « Intéressé » quand la qualification démarre ou que le score est élevé", () => {
    expect(computeAutoStage("NEW", false, { intent: "autre", qualificationStatus: "QUALIFYING" })).toBe("INTERESTED");
    expect(computeAutoStage("NEW", false, { intent: "autre", leadScore: 55 })).toBe("INTERESTED");
  });

  it("passe à « A commandé » quand une commande ou un rendez-vous est enregistré", () => {
    expect(computeAutoStage("NEW", false, { converted: true })).toBe("ORDERED");
    expect(computeAutoStage("CALLBACK", false, { converted: true })).toBe("ORDERED");
  });

  it("ne rétrograde jamais « A commandé »", () => {
    expect(computeAutoStage("ORDERED", false, { intent: "salutation", handoff: true })).toBe("ORDERED");
  });

  it("passe à « À rappeler » quand l'IA passe la main, et y reste", () => {
    expect(computeAutoStage("INTERESTED", false, { handoff: true })).toBe("CALLBACK");
    expect(computeAutoStage("CALLBACK", false, { intent: "demande_prix" })).toBe("CALLBACK");
  });

  it("respecte le choix manuel du propriétaire", () => {
    expect(computeAutoStage("NEW", true, { intent: "achat", converted: true, handoff: true })).toBe("NEW");
  });
});

describe("stagePriority", () => {
  it("met d'abord les clients qui attendent une personne", () => {
    const order = [
      stagePriority("ORDERED", "OPEN"),
      stagePriority("NEW", "OPEN"),
      stagePriority("INTERESTED", "OPEN"),
      stagePriority("NEW", "HUMAN_HANDOFF"),
    ];
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    expect(stagePriority("NEW", "HUMAN_HANDOFF")).toBe(0);
  });
});
