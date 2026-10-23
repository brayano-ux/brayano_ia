import { describe, expect, it } from "vitest";
import { lastDays, sumUsage } from "./platform-usage.js";

describe("usage de la plateforme", () => {
  it("compte les jours à l'heure du Cameroun (UTC+1)", () => {
    // 23 h 30 UTC le 22 octobre = 0 h 30 le 23 octobre au Cameroun
    const now = Date.UTC(2026, 9, 22, 23, 30);
    expect(lastDays(3, now)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(lastDays(3, Date.UTC(2026, 9, 22, 12, 0)).at(-1)).toBe("2026-10-22");
  });

  it("additionne les réponses de toutes les entreprises", () => {
    expect(sumUsage([
      { today: 1, last7Days: 5, last30Days: 9, total: 20, lastAt: null },
      { today: 2, last7Days: 3, last30Days: 4, total: 30, lastAt: "2026-10-01T00:00:00.000Z" },
    ])).toEqual({ today: 3, last7Days: 8, last30Days: 13, total: 50 });
  });
});
