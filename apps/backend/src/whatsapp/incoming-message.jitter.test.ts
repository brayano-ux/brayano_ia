import { describe, expect, it } from "vitest";
import { jitteredDelayMs } from "./incoming-message.js";

describe("jitteredDelayMs", () => {
  it("reste dans une marge de ±20 % autour du délai configuré", () => {
    expect(jitteredDelayMs(5, () => 0)).toBeCloseTo(4_000); // 5s * 0.8
    expect(jitteredDelayMs(5, () => 1)).toBeCloseTo(6_000); // 5s * 1.2
    expect(jitteredDelayMs(5, () => 0.5)).toBeCloseTo(5_000); // 5s * 1.0 (milieu)
  });

  it("varie d'un appel à l'autre au lieu de retomber toujours sur la même valeur", () => {
    const values = new Set([0.1, 0.3, 0.6, 0.9].map((r) => jitteredDelayMs(60, () => r)));
    expect(values.size).toBeGreaterThan(1);
  });
});
