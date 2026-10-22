import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BILLING_PLANS, TRIAL, cheapestPlanWith, getBillingPlan } from "./billing-plans.js";

describe("forfaits", () => {
  it("les trois forfaits montent en prix, en messages et en fonctions", () => {
    const { starter, pro, scale } = BILLING_PLANS;
    expect([starter.amount, pro.amount, scale.amount]).toEqual([10000, 20000, 50000]);
    expect(starter.messages).toBeLessThan(pro.messages);
    expect(pro.messages).toBeLessThan(scale.messages);
    expect(starter.features).toEqual({ broadcasts: false, followUps: false, teamMembers: 0 });
    expect(pro.features).toEqual({ broadcasts: true, followUps: true, teamMembers: 3 });
    expect(scale.features.teamMembers).toBeGreaterThan(pro.features.teamMembers);
  });

  it("l'essai gratuit donne 100 messages et toutes les fonctions du Pro, pour tout montrer", () => {
    expect(TRIAL.messages).toBe(100);
    expect(TRIAL.features).toEqual(BILLING_PLANS.pro.features);
  });

  it("retrouve un forfait par son nom, en français ou en anglais", () => {
    expect(getBillingPlan("Essentiel").key).toBe("starter");
    expect(getBillingPlan(" BUSINESS ").key).toBe("scale");
    expect(getBillingPlan("pro").key).toBe("pro");
    expect(() => getBillingPlan("gratuit")).toThrow("Plan de paiement inconnu");
  });

  it("indique le forfait le moins cher qui ouvre chaque fonction", () => {
    expect(cheapestPlanWith("broadcasts").name).toBe("Pro");
    expect(cheapestPlanWith("followUps").name).toBe("Pro");
  });

  it("chaque forfait annonce le nombre de messages et le prix qu'il applique vraiment", () => {
    for (const plan of Object.values(BILLING_PLANS)) {
      const formatted = new Intl.NumberFormat("fr-FR").format(plan.messages).replace(/\s/g, " ");
      expect(plan.highlights[0]!.replace(/\s/g, " ")).toContain(formatted);
      expect(plan.description.replace(/\s/g, " ")).toContain(formatted);
    }
  });

  it("la page d'accueil affiche les mêmes prix et les mêmes quantités que les forfaits (une seule vérité)", () => {
    const landing = readFileSync(path.resolve(__dirname, "../../../dashboard/index.html"), "utf8");
    if (!landing.includes('id="tarifs"')) return; // section ajoutée avec la page d'accueil complète
    const text = landing.replace(/&nbsp;| | /g, " ").replace(/\s+/g, " ");
    for (const plan of Object.values(BILLING_PLANS)) {
      expect(text).toContain(`${new Intl.NumberFormat("fr-FR").format(plan.amount).replace(/\s/g, " ")}`);
      expect(text).toContain(plan.name);
    }
    expect(text).toContain(`${TRIAL.messages} messages`);
  });
});
