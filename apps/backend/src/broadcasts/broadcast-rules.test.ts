import { describe, expect, it } from "vitest";
import { BROADCAST_LIMITS, checkBroadcastQuota, pickDelayMs, withOptOutFooter } from "./broadcast-rules.js";

describe("withOptOutFooter", () => {
  it("ajoute toujours la mention STOP", () => {
    expect(withOptOutFooter("  Promo ce week-end !  ")).toBe("Promo ce week-end !\n\nPour ne plus recevoir nos messages, répondez STOP.");
  });
});

describe("pickDelayMs", () => {
  it("reste entre les bornes", () => {
    expect(pickDelayMs(0)).toBe(BROADCAST_LIMITS.minDelayMs);
    expect(pickDelayMs(1)).toBe(BROADCAST_LIMITS.maxDelayMs);
    expect(pickDelayMs(0.5)).toBe(14_000);
    expect(pickDelayMs(7)).toBe(BROADCAST_LIMITS.maxDelayMs);
    expect(pickDelayMs(-3)).toBe(BROADCAST_LIMITS.minDelayMs);
  });
});

describe("checkBroadcastQuota", () => {
  it("accepte un envoi raisonnable", () => {
    expect(checkBroadcastQuota({ recipients: 20, sentLast24h: 0, pendingNow: 0 })).toEqual({ ok: true, remainingToday: 100 });
  });

  it("refuse un envoi vide ou trop gros", () => {
    expect(checkBroadcastQuota({ recipients: 0, sentLast24h: 0, pendingNow: 0 }).ok).toBe(false);
    const tooMany = checkBroadcastQuota({ recipients: 51, sentLast24h: 0, pendingNow: 0 });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.reason).toContain("50 clients");
  });

  it("tient compte de ce qui est déjà parti ou en cours aujourd'hui", () => {
    const result = checkBroadcastQuota({ recipients: 40, sentLast24h: 50, pendingNow: 20 });
    expect(result.ok).toBe(false);
    expect(result.remainingToday).toBe(30);
    expect(result.reason).toContain("il en reste 30");
    expect(checkBroadcastQuota({ recipients: 30, sentLast24h: 50, pendingNow: 20 }).ok).toBe(true);
  });
});
