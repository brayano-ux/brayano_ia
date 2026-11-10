import { beforeEach, describe, expect, it } from "vitest";
import {
  buildGroupedMessagesSection, carryWelcomeOver, clearPendingGroup, isLatestInbound, pendingGroup, registerPendingInbound, resetMessageGroupingForTests, takeCarriedWelcome,
} from "./message-grouping.js";

const entry = (externalId: string, text = externalId) => ({ externalId, text, requestText: text, hasMedia: false });

describe("regroupement des messages envoyés à la suite", () => {
  beforeEach(() => resetMessageGroupingForTests());

  it("seul le dernier message d'une rafale porte la réponse", () => {
    registerPendingInbound("conv", entry("A"));
    expect(isLatestInbound("conv", "A")).toBe(true);
    registerPendingInbound("conv", entry("B"));
    expect(isLatestInbound("conv", "A")).toBe(false);
    expect(isLatestInbound("conv", "B")).toBe(true);
    expect(pendingGroup("conv").map((item) => item.externalId)).toEqual(["A", "B"]);
  });

  it("sépare les conversations", () => {
    registerPendingInbound("conv-1", entry("A"));
    registerPendingInbound("conv-2", entry("B"));
    expect(isLatestInbound("conv-1", "A")).toBe(true);
    expect(pendingGroup("conv-2").map((item) => item.externalId)).toEqual(["B"]);
  });

  it("vide le groupe une fois traité, sans toucher à un message arrivé entre-temps", () => {
    registerPendingInbound("conv", entry("A"));
    registerPendingInbound("conv", entry("B"));
    registerPendingInbound("conv", entry("C"));
    clearPendingGroup("conv", ["A", "B"]);
    expect(pendingGroup("conv").map((item) => item.externalId)).toEqual(["C"]);
    expect(isLatestInbound("conv", "C")).toBe(true);
    clearPendingGroup("conv", ["C"]);
    expect(pendingGroup("conv")).toEqual([]);
    expect(isLatestInbound("conv", "C")).toBe(false);
  });

  it("ne rattache pas un vieux message resté sans réponse au groupe suivant", () => {
    const now = Date.now();
    registerPendingInbound("conv", entry("OLD"), now - 20 * 60_000);
    registerPendingInbound("conv", entry("NEW"), now);
    expect(pendingGroup("conv", now).map((item) => item.externalId)).toEqual(["NEW"]);
  });

  it("transmet une seule fois l'accueil déjà envoyé à la réponse suivante", () => {
    carryWelcomeOver("conv", "Bienvenue 👋");
    expect(takeCarriedWelcome("conv")).toBe("Bienvenue 👋");
    expect(takeCarriedWelcome("conv")).toBeNull();
  });

  it("n'ajoute une consigne au prompt que pour plusieurs messages", () => {
    expect(buildGroupedMessagesSection(1)).toBeNull();
    expect(buildGroupedMessagesSection(3)).toContain("3 messages d'affilée");
  });
});
