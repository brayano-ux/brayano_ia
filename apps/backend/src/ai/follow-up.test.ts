import { describe, expect, it } from "vitest";
import { buildFollowUpInstruction, isDueForFollowUp, type FollowUpCandidate } from "./follow-up.js";

const NOW = new Date("2026-10-14T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600_000);
const rules = { delayHours: 24, max: 1 };

const base: FollowUpCandidate = {
  stage: "INTERESTED",
  status: "OPEN",
  aiEnabled: true,
  followUpCount: 0,
  optedOut: false,
  lastMessage: { direction: "OUTBOUND", author: "AI", createdAt: hoursAgo(30), aiMeta: { intent: "demande_prix", nextAction: "continue" } },
};

describe("isDueForFollowUp", () => {
  it("relance un client intéressé qui n'a pas répondu depuis plus que le délai", () => {
    expect(isDueForFollowUp(base, rules, NOW)).toBe(true);
  });

  it("attend la fin du délai", () => {
    expect(isDueForFollowUp({ ...base, lastMessage: { ...base.lastMessage!, createdAt: hoursAgo(23) } }, rules, NOW)).toBe(false);
  });

  it("ne relance pas une conversation trop ancienne", () => {
    expect(isDueForFollowUp({ ...base, lastMessage: { ...base.lastMessage!, createdAt: hoursAgo(24 * 8) } }, rules, NOW)).toBe(false);
  });

  it("ne relance pas quand le client a parlé en dernier ou quand un humain a répondu", () => {
    expect(isDueForFollowUp({ ...base, lastMessage: { ...base.lastMessage!, direction: "INBOUND", author: "CONTACT" } }, rules, NOW)).toBe(false);
    expect(isDueForFollowUp({ ...base, lastMessage: { ...base.lastMessage!, author: "HUMAN" } }, rules, NOW)).toBe(false);
  });

  it.each([
    ["un client qui a commandé", { stage: "ORDERED" as const }],
    ["un client à rappeler par une personne", { stage: "CALLBACK" as const }],
    ["un simple nouveau contact", { stage: "NEW" as const }],
    ["une conversation en prise de main humaine", { status: "HUMAN_HANDOFF" as const, aiEnabled: false }],
    ["une conversation fermée", { status: "CLOSED" as const }],
    ["un client qui a écrit STOP", { optedOut: true }],
    ["le nombre maximum de relances atteint", { followUpCount: 1 }],
  ])("ne relance pas %s", (_label, override) => {
    expect(isDueForFollowUp({ ...base, ...override }, rules, NOW)).toBe(false);
  });

  it("ne relance pas après un remerciement, un message d'accueil ou une fin de conversation", () => {
    for (const aiMeta of [{ intent: "remerciement" }, { kind: "welcome" }, { kind: "opt_out" }, { nextAction: "stop" }, { kind: "broadcast" }]) {
      expect(isDueForFollowUp({ ...base, lastMessage: { ...base.lastMessage!, aiMeta } }, rules, NOW)).toBe(false);
    }
  });

  it("autorise une seconde relance quand le maximum est de 2", () => {
    expect(isDueForFollowUp({ ...base, followUpCount: 1 }, { delayHours: 24, max: 2 }, NOW)).toBe(true);
  });

  it("ne fait rien sans message", () => {
    expect(isDueForFollowUp({ ...base, lastMessage: null }, rules, NOW)).toBe(false);
  });
});

describe("buildFollowUpInstruction", () => {
  it("demande un message court, sans action, avec une sortie SKIP possible", () => {
    const instruction = buildFollowUpInstruction({ hoursSinceLastMessage: 26.4, followUpNumber: 1 });
    expect(instruction).toContain("environ 26 h");
    expect(instruction).toContain("deux phrases au maximum");
    expect(instruction).toContain("réponds exactement SKIP");
  });
});
