import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { shouldReactivateAiAfterHandoff } from "./conversations.service.js";

describe("shouldReactivateAiAfterHandoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reactivates the AI after 24 hours from a human handoff", () => {
    const staleDate = new Date("2026-01-09T11:00:00.000Z");

    expect(shouldReactivateAiAfterHandoff(staleDate)).toBe(true);
  });

  it("does not reactivate before 24 hours have passed", () => {
    const recentDate = new Date("2026-01-09T13:30:00.000Z");

    expect(shouldReactivateAiAfterHandoff(recentDate)).toBe(false);
  });
});
