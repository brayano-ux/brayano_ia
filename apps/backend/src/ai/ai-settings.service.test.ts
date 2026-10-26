import { describe, expect, it } from "vitest";
import { resolveResponseDelaySeconds } from "./ai-settings.service.js";

describe("resolveResponseDelaySeconds", () => {
  it("defaults to 3 seconds", () => {
    expect(resolveResponseDelaySeconds(undefined)).toBe(3);
    expect(resolveResponseDelaySeconds(3)).toBe(3);
    expect(resolveResponseDelaySeconds(4)).toBe(3);
  });

  it("accepts 5 and 7 seconds", () => {
    expect(resolveResponseDelaySeconds(5)).toBe(5);
    expect(resolveResponseDelaySeconds(7)).toBe(7);
  });
});
