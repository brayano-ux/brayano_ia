import { describe, expect, it } from "vitest";
import { isLikelyBot } from "./landing-views.service.js";

describe("détection des robots (page d'accueil)", () => {
  it("écarte les robots connus et les en-têtes vides", () => {
    for (const userAgent of ["", "   ", "Googlebot/2.1", "Mozilla/5.0 (compatible; bingbot/2.0)", "facebookexternalhit/1.1", "UptimeRobot/2.0"]) {
      expect(isLikelyBot(userAgent), userAgent).toBe(true);
    }
  });

  it("garde un vrai navigateur", () => {
    expect(isLikelyBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")).toBe(false);
  });
});
