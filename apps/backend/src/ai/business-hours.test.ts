import { describe, expect, it } from "vitest";
import { buildBusinessHoursPrompt, describeHours, getOpeningStatus, isGoodTimeToFollowUp } from "./business-hours.js";

const config = {
  enabled: true,
  timezone: "Africa/Douala", // UTC+1, pas de changement d'heure
  hours: {
    mon: [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
    tue: [{ start: "08:00", end: "18:00" }],
    sat: [{ start: "08:00", end: "13:00" }],
  },
};

// 2026-10-12 est un lundi.
const at = (iso: string) => new Date(iso);

describe("getOpeningStatus", () => {
  it("est ouvert pendant une plage", () => {
    expect(getOpeningStatus(config, at("2026-10-12T08:30:00Z")).open).toBe(true); // 09:30 locale
  });

  it("est fermé pendant la pause et annonce la réouverture du jour", () => {
    const status = getOpeningStatus(config, at("2026-10-12T12:00:00Z")); // 13:00 locale
    expect(status.open).toBe(false);
    expect(status.next?.label).toBe("aujourd'hui à 14:00");
  });

  it("annonce « demain » le soir", () => {
    const status = getOpeningStatus(config, at("2026-10-12T20:00:00Z")); // 21:00 locale, lundi
    expect(status.next?.label).toBe("demain à 08:00");
  });

  it("saute les jours fermés (vendredi soir → samedi)", () => {
    const status = getOpeningStatus(config, at("2026-10-16T20:00:00Z")); // vendredi 21:00 (fermé toute la journée)
    expect(status.next?.label).toBe("demain à 08:00"); // samedi
    expect(status.next?.date).toBe("2026-10-17");
  });

  it("annonce le jour de la semaine quand la réouverture n'est pas demain (samedi soir → mardi)", () => {
    const status = getOpeningStatus(config, at("2026-10-17T20:00:00Z")); // samedi 21:00 → dimanche fermé, lundi 08:00
    expect(status.next?.label).toBe("lundi à 08:00");
    expect(status.next?.date).toBe("2026-10-19");
  });

  it("gère une entreprise sans aucune plage", () => {
    expect(getOpeningStatus({ ...config, hours: {} }, at("2026-10-12T08:00:00Z"))).toEqual({ open: false, next: null });
  });
});

describe("buildBusinessHoursPrompt", () => {
  it("n'ajoute rien quand les horaires sont désactivés", () => {
    expect(buildBusinessHoursPrompt({ ...config, enabled: false }, new Date())).toBeNull();
  });

  it("donne les consignes de fermeture avec la prochaine ouverture", () => {
    const prompt = buildBusinessHoursPrompt({ ...config, closedMessage: "Proposer de laisser un message." }, at("2026-10-12T20:00:00Z"))!;
    expect(prompt).toContain("FERMÉE");
    expect(prompt).toContain("demain à 08:00");
    expect(prompt).toContain("Proposer de laisser un message.");
    expect(prompt).toContain("Lundi : 08:00–12:00 et 14:00–18:00");
  });

  it("ne donne pas de consigne de fermeture quand l'entreprise est ouverte", () => {
    const prompt = buildBusinessHoursPrompt(config, at("2026-10-12T08:30:00Z"))!;
    expect(prompt).toContain("OUVERTE");
    expect(prompt).not.toContain("Comme l'entreprise est fermée");
  });
});

describe("describeHours", () => {
  it("écrit « fermé » pour les jours sans plage", () => {
    expect(describeHours(config.hours)).toContain("Dimanche : fermé");
  });
});

describe("isGoodTimeToFollowUp", () => {
  it("suit les horaires configurés", () => {
    expect(isGoodTimeToFollowUp(config, at("2026-10-12T08:30:00Z"))).toBe(true);
    expect(isGoodTimeToFollowUp(config, at("2026-10-12T20:00:00Z"))).toBe(false);
  });

  it("sans horaires, évite la nuit (8 h – 20 h)", () => {
    expect(isGoodTimeToFollowUp(null, at("2026-10-12T09:00:00Z"))).toBe(true); // 10:00
    expect(isGoodTimeToFollowUp(null, at("2026-10-12T23:00:00Z"))).toBe(false); // 00:00
  });
});
