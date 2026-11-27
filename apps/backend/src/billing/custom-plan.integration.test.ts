import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Emails envoyés : au client (notifyOrganizationAdmins) et à l'administrateur de la plateforme (notifyPlatformAdmins). */
const emails = vi.hoisted(() => ({ client: [] as string[], platform: [] as string[] }));
vi.mock("../notifications/owner-notifications.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../notifications/owner-notifications.js")>();
  return {
    ...original,
    notifyOrganizationAdmins: vi.fn(async (_id: string, build: (name: string) => { subject: string }) => { emails.client.push(build("Salon Éclat").subject); }),
    notifyPlatformAdmins: vi.fn(async (_id: string, build: (name: string) => { subject: string }) => { emails.platform.push(build("Salon Éclat").subject); }),
  };
});

import { prisma } from "../database/client.js";
import { createCustomClient } from "../organizations/custom-clients.service.js";
import { PlanLimitError, ValidationError } from "../shared/errors.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import {
  CUSTOM_PLAN_EXPIRES_AT, assertCanAddTeamMember, assertFeature, checkExpiringSubscriptions, getOrganizationBillingStatus,
  isCustomPlan, notifyQuotaReached, removeCustomPlan, reserveAiResponse, setBillingEnforcedForTests, setCustomPlan,
} from "./subscription.service.js";

const DAY = 24 * 3600_000;
const PLAN = { messageLimit: 3, broadcasts: true, followUps: false, teamMembers: 2 };

describe.skipIf(!integrationEnabled)("formule sur mesure (base réelle)", () => {
  beforeEach(async () => {
    await resetDatabase();
    emails.client.length = 0;
    emails.platform.length = 0;
    setBillingEnforcedForTests(true);
  });
  afterAll(async () => {
    setBillingEnforcedForTests(null);
    await disconnectTestDatabase();
  });

  it("l'assistant répond jusqu'à la limite fixée par l'administrateur, puis s'arrête", async () => {
    const { organization } = await createTestOrganization();
    await setCustomPlan(organization.id, PLAN);
    for (let index = 0; index < 3; index += 1) expect((await reserveAiResponse(organization.id)).allowed).toBe(true);
    expect(await reserveAiResponse(organization.id)).toEqual({ allowed: false, reason: "message_quota_exhausted" });
    const status = await getOrganizationBillingStatus(organization.id);
    expect(status).toMatchObject({ isCustom: true, plan: "custom", planName: "Sur mesure", blocked: true, messagesUsed: 3, messageLimit: 3, expiresAt: null, amount: null });
  });

  it("le compteur repart à zéro tous les 30 jours, sans date de fin", async () => {
    const { organization } = await createTestOrganization();
    await setCustomPlan(organization.id, PLAN, new Date(Date.now() - 31 * DAY));
    await prisma.billingSubscription.update({ where: { organizationId: organization.id }, data: { messagesUsed: 3 } });
    expect((await reserveAiResponse(organization.id)).allowed).toBe(true);
    const row = await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId: organization.id } });
    expect(row.messagesUsed).toBe(1);
    expect(row.expiresAt.getTime()).toBe(CUSTOM_PLAN_EXPIRES_AT.getTime());
  });

  it("ouvre exactement les fonctions choisies, avec des messages qui renvoient vers Brayano Service et pas vers « Mon forfait »", async () => {
    const { organization } = await createTestOrganization();
    await setCustomPlan(organization.id, PLAN);
    await expect(assertFeature(organization.id, "broadcasts")).resolves.toBeUndefined();
    await expect(assertFeature(organization.id, "followUps")).rejects.toThrow(/formule sur mesure.*Brayano Service/);
    await expect(assertCanAddTeamMember(organization.id, 1)).resolves.toBeUndefined();
    const error = await assertCanAddTeamMember(organization.id, 2).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlanLimitError);
    expect((error as Error).message).toContain("permet 2 employés");
    expect((error as Error).message).not.toContain("Mon forfait");
  });

  it("limite atteinte : le client est invité à contacter Brayano Service, l'administrateur est prévenu, une seule fois par période", async () => {
    const { organization } = await createTestOrganization();
    await setCustomPlan(organization.id, PLAN);
    // Pas d'avis tant que la limite n'est pas vraiment atteinte (ex. formule modifiée pendant une réponse).
    expect(await notifyQuotaReached(organization.id, "message_quota_exhausted")).toBe(false);
    for (let index = 0; index < 3; index += 1) await reserveAiResponse(organization.id);
    expect(await notifyQuotaReached(organization.id, "message_quota_exhausted")).toBe(true);
    expect(emails.client).toEqual(["⚠️ Limite mensuelle atteinte : l'assistant ne répond plus pour le moment"]);
    expect(emails.platform).toEqual(["Client sur mesure : Salon Éclat a atteint sa limite"]);
    // Le lendemain, toujours à la limite : pas de second email dans la même période.
    expect(await notifyQuotaReached(organization.id, "message_quota_exhausted", new Date(Date.now() + 2 * DAY))).toBe(false);
    expect(emails.client).toHaveLength(1);
  });

  it("la formule s'applique même quand les forfaits de l'application ne sont pas appliqués (BILLING_ENFORCED)", async () => {
    setBillingEnforcedForTests(false);
    const { organization } = await createTestOrganization();
    await setCustomPlan(organization.id, PLAN);
    // Fonctions : seulement celles choisies (les autres entreprises gardent tout).
    await expect(assertFeature(organization.id, "broadcasts")).resolves.toBeUndefined();
    await expect(assertFeature(organization.id, "followUps")).rejects.toThrow(/formule sur mesure/);
    await expect(assertCanAddTeamMember(organization.id, 2)).rejects.toBeInstanceOf(PlanLimitError);
    // Limite de messages : appliquée.
    for (let index = 0; index < 3; index += 1) expect((await reserveAiResponse(organization.id)).allowed).toBe(true);
    expect(await reserveAiResponse(organization.id)).toEqual({ allowed: false, reason: "message_quota_exhausted" });
    expect(await getOrganizationBillingStatus(organization.id)).toMatchObject({ enforced: true, blocked: true });
    // Une entreprise ordinaire, elle, garde tout tant que les forfaits ne sont pas appliqués.
    const { organization: other } = await createTestOrganization("Autre", { email: "autre@example.com" });
    await expect(assertFeature(other.id, "followUps")).resolves.toBeUndefined();
  });

  it("une entreprise suspendue apparaît « en pause » : l'agent ne répond plus, aucune fonction ouverte", async () => {
    const { organization } = await createTestOrganization();
    await setCustomPlan(organization.id, PLAN);
    await prisma.organization.update({ where: { id: organization.id }, data: { platformSuspended: true } });
    expect(await getOrganizationBillingStatus(organization.id)).toMatchObject({ isCustom: true, status: "EXPIRED", blocked: true, features: { broadcasts: false, teamMembers: 0 } });
  });

  it("aucun rappel d'échéance ni email de paiement, même après des années", async () => {
    const { organization } = await createTestOrganization();
    await setCustomPlan(organization.id, PLAN);
    expect(await checkExpiringSubscriptions(new Date(Date.now() + 3650 * DAY))).toBe(0);
    expect(emails.client).toEqual([]);
    expect((await reserveAiResponse(organization.id)).allowed).toBe(true);
  });

  it("relever la limite réveille l'assistant sans remettre le compteur à zéro", async () => {
    const { organization } = await createTestOrganization();
    await setCustomPlan(organization.id, PLAN);
    for (let index = 0; index < 3; index += 1) await reserveAiResponse(organization.id);
    await notifyQuotaReached(organization.id, "message_quota_exhausted");
    const status = await setCustomPlan(organization.id, { ...PLAN, messageLimit: 10 });
    expect(status).toMatchObject({ messagesUsed: 3, messageLimit: 10, remainingMessages: 7, blocked: false });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).quotaNoticeAt).toBeNull();
  });

  it("un client qui avait un forfait payé repart de zéro en passant en sur mesure, et peut être rendu aux forfaits", async () => {
    const { organization } = await createTestOrganization();
    await prisma.billingSubscription.create({
      data: { organizationId: organization.id, plan: "pro", messageLimit: 5000, messagesUsed: 4200, status: "ACTIVE", expiresAt: new Date(Date.now() + 5 * DAY) },
    });
    const status = await setCustomPlan(organization.id, PLAN);
    expect(status).toMatchObject({ isCustom: true, messagesUsed: 0, messageLimit: 3 });
    expect(await isCustomPlan(organization.id)).toBe(true);
    const back = await removeCustomPlan(organization.id);
    // Rendu aux forfaits : forfait terminé à renouveler en ligne, sans essai gratuit fictif.
    expect(back).toMatchObject({ isCustom: false, isTrial: false, status: "EXPIRED", blocked: true });
    expect(await isCustomPlan(organization.id)).toBe(false);
  });

  it("l'administrateur crée le client : entreprise, compte du gérant et formule, sans essai gratuit", async () => {
    const client = await createCustomClient({
      companyName: "Pharmacie du Port", ownerName: "Paul Ndzi", email: "Paul@Example.com", password: "provisoire123", whatsappNumber: "+237 6 90 11 22 33", plan: PLAN,
    });
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: client.organizationId }, include: { users: true, aiSettings: true } });
    expect(organization).toMatchObject({ name: "Pharmacie du Port", whatsappNumber: "237690112233", freeAiResponsesRemaining: 0 });
    expect(organization.users).toHaveLength(1);
    expect(organization.users[0]).toMatchObject({ email: "paul@example.com", role: "ADMIN", name: "Paul Ndzi" });
    expect(organization.aiSettings).not.toBeNull();
    expect(client.billing).toMatchObject({ isCustom: true, messageLimit: 3, features: { broadcasts: true, followUps: false, teamMembers: 2 } });

    await expect(createCustomClient({ companyName: "Autre", ownerName: "Autre", email: "paul@example.com", password: "provisoire123", plan: PLAN }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createCustomClient({ companyName: "Autre", ownerName: "Autre", email: "autre@example.com", password: "provisoire123", whatsappNumber: "abc", plan: PLAN }))
      .rejects.toThrow(/Numéro WhatsApp invalide/);
    expect(await prisma.organization.count()).toBe(1);
  });
});
