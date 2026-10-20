import { describe, expect, it } from "vitest";
import { BROADCAST_LIMITS, pickDelayMs, planBroadcastBatch, withOptOutFooter } from "./broadcast-rules.js";

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

describe("planBroadcastBatch", () => {
  it("envoie tout quand le groupe tient dans un lot", () => {
    expect(planBroadcastBatch({ eligible: 20, sentLast24h: 0, pendingNow: 0 })).toEqual({ ok: true, batchSize: 20, remaining: 0, remainingToday: 100 });
  });

  it("découpe en lots de 50 au lieu de bloquer quand le groupe est plus grand", () => {
    expect(planBroadcastBatch({ eligible: 130, sentLast24h: 0, pendingNow: 0 })).toEqual({ ok: true, batchSize: 50, remaining: 80, remainingToday: 100 });
    expect(planBroadcastBatch({ eligible: 51, sentLast24h: 0, pendingNow: 0 })).toMatchObject({ ok: true, batchSize: 50, remaining: 1 });
  });

  it("refuse seulement un envoi vide", () => {
    const result = planBroadcastBatch({ eligible: 0, sentLast24h: 0, pendingNow: 0 });
    expect(result).toMatchObject({ ok: false, batchSize: 0 });
    expect(result.reason).toContain("Aucun client");
  });

  it("réduit le lot à ce qu'il reste de la limite des 24 h", () => {
    const result = planBroadcastBatch({ eligible: 40, sentLast24h: 50, pendingNow: 20 });
    expect(result).toEqual({ ok: true, batchSize: 30, remaining: 10, remainingToday: 30 });
  });

  it("explique quand la limite des 24 h est atteinte", () => {
    const result = planBroadcastBatch({ eligible: 40, sentLast24h: 80, pendingNow: 20 });
    expect(result).toMatchObject({ ok: false, batchSize: 0, remaining: 40, remainingToday: 0 });
    expect(result.reason).toContain("Limite de 100 messages");
  });
});
