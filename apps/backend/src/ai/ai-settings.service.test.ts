import { describe, expect, it } from "vitest";
import { DEFAULT_RESPONSE_DELAY_SECONDS, resolveResponseDelaySeconds } from "./ai-settings.service.js";

describe("resolveResponseDelaySeconds", () => {
  it("vaut 5 secondes par défaut (valeur absente ou inconnue)", () => {
    expect(DEFAULT_RESPONSE_DELAY_SECONDS).toBe(5);
    expect(resolveResponseDelaySeconds(undefined)).toBe(5);
    expect(resolveResponseDelaySeconds(null)).toBe(5);
    expect(resolveResponseDelaySeconds(4)).toBe(5);
    expect(resolveResponseDelaySeconds("5")).toBe(5);
  });

  it("garde le choix explicite du propriétaire : 3, 5, 7 s, 1 ou 2 min", () => {
    expect(resolveResponseDelaySeconds(3)).toBe(3);
    expect(resolveResponseDelaySeconds(5)).toBe(5);
    expect(resolveResponseDelaySeconds(7)).toBe(7);
    expect(resolveResponseDelaySeconds(60)).toBe(60);
    expect(resolveResponseDelaySeconds(120)).toBe(120);
  });
});
