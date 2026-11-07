import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRIES, splitInternationalNumber } from "./countries.js";

describe("liste des pays", () => {
  it("est identique à celle du tableau de bord (nom et indicatif)", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../dashboard/src/utils/francophone-countries.js"), "utf8");
    const dashboard = [...source.matchAll(/\{ name: "([^"]+)", flag: "[^"]*", dialCode: "(\d+)" \}/g)].map((m) => ({ name: m[1], dialCode: m[2] }));
    expect(dashboard.length).toBeGreaterThan(20);
    expect(COUNTRIES.map(({ name, dialCode }) => ({ name, dialCode }))).toEqual(dashboard);
  });

  it("a des indicatifs à 3 chiffres uniques et des codes ISO à 2 lettres uniques", () => {
    expect(new Set(COUNTRIES.map((c) => c.dialCode)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.iso)).size).toBe(COUNTRIES.length);
    for (const country of COUNTRIES) {
      expect(country.dialCode).toMatch(/^\d{3}$/);
      expect(country.iso).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("splitInternationalNumber", () => {
  it("retrouve le pays et le numéro local", () => {
    expect(splitInternationalNumber("237690000000")).toEqual({ country: expect.objectContaining({ iso: "CM" }), local: "690000000" });
    expect(splitInternationalNumber("2250700000000")).toEqual({ country: expect.objectContaining({ iso: "CI", name: "Côte d'Ivoire" }), local: "0700000000" });
    expect(splitInternationalNumber("221770000000")).toEqual({ country: expect.objectContaining({ iso: "SN" }), local: "770000000" });
  });

  it("refuse un indicatif hors liste ou un numéro sans partie locale", () => {
    expect(splitInternationalNumber("33612345678")).toBeNull();
    expect(splitInternationalNumber("237")).toBeNull();
    expect(splitInternationalNumber("")).toBeNull();
  });
});
