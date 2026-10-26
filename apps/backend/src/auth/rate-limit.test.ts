import { beforeEach, describe, expect, it } from "vitest";
import { clearRateLimit, evaluateRateLimit, isRateLimited, recordFailure, resetRateLimitsForTests } from "./rate-limit.js";

beforeEach(() => resetRateLimitsForTests());

describe("limiteur de tentatives", () => {
  it("bloque au-delà de la limite puis libère à la fin de la fenêtre", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(evaluateRateLimit("ip:a", 3, 60_000, now)).toBe(true);
    expect(evaluateRateLimit("ip:a", 3, 60_000, now + 1)).toBe(false);
    expect(evaluateRateLimit("ip:b", 3, 60_000, now)).toBe(true);
    expect(evaluateRateLimit("ip:a", 3, 60_000, now + 60_001)).toBe(true);
  });

  it("ne compte que les échecs quand on utilise recordFailure", () => {
    const now = 5_000_000;
    for (let i = 0; i < 4; i++) recordFailure("compte", 900_000, now);
    expect(isRateLimited("compte", 5, now)).toBe(false);
    recordFailure("compte", 900_000, now);
    expect(isRateLimited("compte", 5, now)).toBe(true);
    expect(isRateLimited("compte", 5, now + 900_001)).toBe(false);
    recordFailure("compte", 900_000, now + 900_002);
    clearRateLimit("compte");
    expect(isRateLimited("compte", 1, now + 900_003)).toBe(false);
  });

  it("purge les compteurs expirés pour ne pas saturer la mémoire", () => {
    const now = 9_000_000;
    for (let i = 0; i < 1000; i++) evaluateRateLimit(`spoof:${i}`, 1, 1_000, now);
    // Un appel bien plus tard déclenche la purge : les anciennes clés sont reparties à zéro.
    expect(evaluateRateLimit("spoof:0", 1, 1_000, now + 120_000)).toBe(true);
    expect(evaluateRateLimit("spoof:0", 1, 1_000, now + 120_001)).toBe(false);
  });
});
