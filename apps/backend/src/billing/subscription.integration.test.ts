import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const notices = vi.hoisted(() => ({ calls: [] as Array<{ organizationId: string }> }));
vi.mock("../notifications/owner-notifications.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../notifications/owner-notifications.js")>();
  return { ...original, notifyOrganizationAdmins: vi.fn(async (organizationId: string) => { notices.calls.push({ organizationId }); }) };
});

import { prisma } from "../database/client.js";
import { PlanLimitError } from "../shared/errors.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import {
  assertCanAddTeamMember, assertFeature, getOrganizationBillingStatus, getOrganizationFeatures, notifyQuotaReached,
  releaseAiResponse, reserveAiResponse, setBillingEnforcedForTests,
} from "./subscription.service.js";

const DAY = 24 * 3600_000;

async function org(options: { credits?: number; plan?: "starter" | "pro" | "scale"; used?: number; limit?: number; expiresInDays?: number; periodStartedDaysAgo?: number; status?: "ACTIVE" | "INACTIVE" } = {}) {
  const { organization } = await createTestOrganization();
  await prisma.organization.update({ where: { id: organization.id }, data: { freeAiResponsesRemaining: options.credits ?? 0 } });
  if (options.plan) {
    await prisma.billingSubscription.create({
      data: {
        organizationId: organization.id, plan: options.plan, messageLimit: options.limit ?? 1000, messagesUsed: options.used ?? 0,
        status: options.status ?? "ACTIVE", expiresAt: new Date(Date.now() + (options.expiresInDays ?? 20) * DAY),
        periodStartedAt: new Date(Date.now() - (options.periodStartedDaysAgo ?? 3) * DAY),
      },
    });
  }
  return organization.id;
}

describe.skipIf(!integrationEnabled)("forfaits et messages de l'assistant (base réelle)", () => {
  beforeEach(async () => {
    await resetDatabase();
    notices.calls.length = 0;
    setBillingEnforcedForTests(true);
  });
  afterAll(async () => {
    setBillingEnforcedForTests(null);
    await disconnectTestDatabase();
  });

  describe("forfaits appliqués", () => {
    it("essai gratuit : chaque message en retire un, puis l'assistant s'arrête", async () => {
      const id = await org({ credits: 2 });
      expect(await reserveAiResponse(id)).toMatchObject({ allowed: true, source: "trial", remaining: 1 });
      expect(await reserveAiResponse(id)).toMatchObject({ allowed: true, source: "trial", remaining: 0 });
      expect(await reserveAiResponse(id)).toEqual({ allowed: false, reason: "trial_exhausted" });
    });

    it("forfait actif : compte les messages jusqu'au quota, puis refuse", async () => {
      const id = await org({ plan: "starter", limit: 3 });
      for (let used = 1; used <= 3; used += 1) expect(await reserveAiResponse(id)).toMatchObject({ allowed: true, source: "subscription", remaining: 3 - used });
      expect(await reserveAiResponse(id)).toEqual({ allowed: false, reason: "message_quota_exhausted" });
      expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId: id } })).messagesUsed).toBe(3);
    });

    it("jamais de dépassement quand 30 messages arrivent en même temps pour un quota de 10", async () => {
      const id = await org({ plan: "starter", limit: 10 });
      const results = await Promise.all(Array.from({ length: 30 }, () => reserveAiResponse(id)));
      expect(results.filter((result) => result.allowed)).toHaveLength(10);
      expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId: id } })).messagesUsed).toBe(10);
    });

    it("abonnement terminé ou inactif : refuse", async () => {
      expect(await reserveAiResponse(await org({ plan: "pro", expiresInDays: -1 }))).toEqual({ allowed: false, reason: "subscription_expired" });
      expect(await reserveAiResponse(await org({ plan: "pro", status: "INACTIVE" }))).toEqual({ allowed: false, reason: "subscription_expired" });
    });

    it("le compteur repart à zéro au début d'une nouvelle période de 30 jours", async () => {
      const id = await org({ plan: "starter", limit: 5, used: 5, periodStartedDaysAgo: 31, expiresInDays: 20 });
      expect(await reserveAiResponse(id)).toMatchObject({ allowed: true, source: "subscription", remaining: 4 });
      expect((await getOrganizationBillingStatus(id)).messagesUsed).toBe(1);
    });

    it("rend le message quand la réponse n'est pas partie (essai et forfait), sans jamais dépasser le plafond", async () => {
      const trial = await org({ credits: 5 });
      const reservation = await reserveAiResponse(trial);
      if (!reservation.allowed) throw new Error("attendu : autorisé");
      await releaseAiResponse(trial, reservation);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: trial } })).freeAiResponsesRemaining).toBe(5);

      const full = await org({ credits: 100 });
      await releaseAiResponse(full, { allowed: true, source: "trial", remaining: 0 });
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: full } })).freeAiResponsesRemaining).toBe(100);

      const sub = await org({ plan: "pro", limit: 10 });
      const taken = await reserveAiResponse(sub);
      if (!taken.allowed || taken.source !== "subscription") throw new Error("attendu : forfait");
      await releaseAiResponse(sub, taken);
      expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId: sub } })).messagesUsed).toBe(0);
    });

    it("annonce l'état au tableau de bord : essai, forfait, quota atteint", async () => {
      const trial = await getOrganizationBillingStatus(await org({ credits: 64 }));
      expect(trial).toMatchObject({ plan: "trial", planName: "Essai gratuit", isTrial: true, enforced: true, blocked: false, messageLimit: 100, messagesUsed: 36, remainingMessages: 64 });
      const out = await getOrganizationBillingStatus(await org({ credits: 0 }));
      expect(out).toMatchObject({ isTrial: true, status: "EXPIRED", blocked: true, remainingMessages: 0 });
      const pro = await getOrganizationBillingStatus(await org({ plan: "pro", limit: 5000, used: 4000 }));
      expect(pro).toMatchObject({ plan: "pro", planName: "Pro", status: "ACTIVE", blocked: false, remainingMessages: 1000, amount: 20000 });
      const full = await getOrganizationBillingStatus(await org({ plan: "starter", limit: 1000, used: 1000 }));
      expect(full).toMatchObject({ blocked: true, remainingMessages: 0 });
    });
  });

  describe("forfaits non appliqués (réglage par défaut) : personne n'est coupé", () => {
    beforeEach(() => setBillingEnforcedForTests(false));

    it("sans forfait ni essai restant, l'assistant répond quand même et rien n'est compté", async () => {
      const id = await org({ credits: 0 });
      expect(await reserveAiResponse(id)).toMatchObject({ allowed: true, source: "unlimited" });
      expect((await getOrganizationBillingStatus(id)).blocked).toBe(false);
    });

    it("un forfait dépassé continue de répondre, mais les messages restent comptés", async () => {
      const id = await org({ plan: "starter", limit: 1, used: 1 });
      expect(await reserveAiResponse(id)).toMatchObject({ allowed: true, source: "unlimited" });
      const own = await org({ plan: "starter", limit: 5, used: 0 });
      expect(await reserveAiResponse(own)).toMatchObject({ allowed: true, source: "subscription" });
      expect((await getOrganizationBillingStatus(own)).messagesUsed).toBe(1);
    });

    it("toutes les fonctions et tous les employés restent permis", async () => {
      const id = await org({ plan: "starter" });
      expect(await getOrganizationFeatures(id)).toMatchObject({ broadcasts: true, followUps: true });
      await expect(assertFeature(id, "broadcasts")).resolves.toBeUndefined();
      await expect(assertCanAddTeamMember(id, 8)).resolves.toBeUndefined();
    });
  });

  describe("fonctions réservées aux forfaits", () => {
    it("Essentiel : ni messages en masse, ni relances, ni employés — avec le forfait qui les ouvre", async () => {
      const id = await org({ plan: "starter" });
      await expect(assertFeature(id, "broadcasts")).rejects.toThrow(PlanLimitError);
      await expect(assertFeature(id, "broadcasts")).rejects.toThrow("forfait Pro");
      await expect(assertFeature(id, "followUps")).rejects.toThrow("relances automatiques ne sont pas incluses");
      await expect(assertCanAddTeamMember(id, 0)).rejects.toThrow("Les employés ne sont pas inclus");
    });

    it("Pro : tout sauf plus de 3 employés ; Business : jusqu'à 10", async () => {
      const pro = await org({ plan: "pro" });
      await expect(assertFeature(pro, "broadcasts")).resolves.toBeUndefined();
      await expect(assertCanAddTeamMember(pro, 2)).resolves.toBeUndefined();
      await expect(assertCanAddTeamMember(pro, 3)).rejects.toThrow("forfait Business");
      const business = await org({ plan: "scale" });
      await expect(assertCanAddTeamMember(business, 9)).resolves.toBeUndefined();
      await expect(assertCanAddTeamMember(business, 10)).rejects.toThrow("permet 10 employés");
    });

    it("essai : toutes les fonctions du Pro ; essai terminé ou abonnement expiré : plus aucune", async () => {
      expect(await getOrganizationFeatures(await org({ credits: 10 }))).toEqual({ broadcasts: true, followUps: true, teamMembers: 3 });
      expect(await getOrganizationFeatures(await org({ credits: 0 }))).toEqual({ broadcasts: false, followUps: false, teamMembers: 0 });
      expect(await getOrganizationFeatures(await org({ plan: "scale", expiresInDays: -2 }))).toEqual({ broadcasts: false, followUps: false, teamMembers: 0 });
    });
  });

  describe("avis au propriétaire quand l'assistant s'arrête", () => {
    it("un seul email par 24 heures", async () => {
      const id = await org({ credits: 0 });
      const now = new Date();
      expect(await notifyQuotaReached(id, "trial_exhausted", now)).toBe(true);
      expect(await notifyQuotaReached(id, "trial_exhausted", new Date(now.getTime() + 3600_000))).toBe(false);
      expect(await notifyQuotaReached(id, "trial_exhausted", new Date(now.getTime() + 25 * 3600_000))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(notices.calls).toHaveLength(2);
    });
  });
});
