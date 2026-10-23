import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSettings } from "../generated/prisma/client.js";
const mocks = vi.hoisted(() => ({ organization: { findUnique: vi.fn() }, message: { findFirst: vi.fn() }, aiSettings: { updateMany: vi.fn() } }));
vi.mock("../database/client.js", () => ({ prisma: mocks }));
import { getOnboardingStatus, markAgentTested, settingsFingerprint } from "./onboarding.service.js";
const settings = () => ({ organizationId: "org-1", agentName: "Awa", businessInfo: "Formation à Douala", systemPrompt: "Réponds aux questions", welcomeMessage: null, agentImageUrl: null, qualificationFields: [], businessHoursEnabled: false, businessHours: null, businessTimezone: "Africa/Douala", closedMessage: null, onboardingTestHash: null, aiEnabled: true, updatedAt: new Date("2026-10-23T10:00:00Z") } as unknown as AiSettings);
beforeEach(() => { vi.resetAllMocks(); mocks.organization.findUnique.mockResolvedValue({ aiSettings: settings(), platformSuspended: false }); mocks.message.findFirst.mockResolvedValue(null); });

describe("guided onboarding status", () => {
  it("does not mark a simulation or a human reply as a real automatic reply", async () => {
    expect(await getOnboardingStatus("org-1", false)).toMatchObject({ profileComplete: true, testComplete: false, whatsappConnected: false, firstReplySent: false });
    expect(mocks.message.findFirst).toHaveBeenCalledWith({ where: { conversation: { organizationId: "org-1" }, direction: "OUTBOUND", author: "AI" }, select: { id: true } });
  });
  it("counts a saved successful test for the same settings", async () => {
    const value = settings(); value.onboardingTestHash = settingsFingerprint(value);
    mocks.organization.findUnique.mockResolvedValue({ aiSettings: value, platformSuspended: false });
    expect(await getOnboardingStatus("org-1", true)).toMatchObject({ testComplete: true, whatsappConnected: true, firstReplySent: false });
  });
  it("asks for a new test when response settings change", async () => {
    const value = settings(); value.onboardingTestHash = settingsFingerprint(value); value.businessInfo = "Autres tarifs";
    mocks.organization.findUnique.mockResolvedValue({ aiSettings: value, platformSuspended: false });
    expect((await getOnboardingStatus("org-1", false)).testComplete).toBe(false);
  });
  it("recognizes existing customers from a delivered AI reply", async () => {
    mocks.message.findFirst.mockResolvedValue({ id: "message-1" });
    expect(await getOnboardingStatus("org-1", true)).toMatchObject({ testComplete: true, firstReplySent: true });
  });
  it("does not mark an empty profile complete", async () => {
    mocks.organization.findUnique.mockResolvedValue({ aiSettings: null, platformSuspended: false });
    expect(await getOnboardingStatus("org-1", false)).toMatchObject({ profileComplete: false, aiEnabled: false });
  });
  it("returns suspension and pause states instead of claiming readiness", async () => {
    mocks.organization.findUnique.mockResolvedValue({ aiSettings: { ...settings(), aiEnabled: false }, platformSuspended: true });
    expect(await getOnboardingStatus("org-1", true)).toMatchObject({ aiEnabled: false, suspended: true });
  });
  it("records only a hash and guards against a concurrent settings change", async () => {
    const value = settings(); await markAgentTested(value);
    expect(mocks.aiSettings.updateMany).toHaveBeenCalledWith({ where: { organizationId: "org-1", updatedAt: value.updatedAt }, data: { onboardingTestHash: settingsFingerprint(value) } });
  });
  it("does not rewrite an unchanged successful test", async () => {
    const value = settings(); value.onboardingTestHash = settingsFingerprint(value); await markAgentTested(value);
    expect(mocks.aiSettings.updateMany).not.toHaveBeenCalled();
  });
  it("does not include timestamps or the hash itself in the fingerprint", () => {
    const value = settings(); const hash = settingsFingerprint(value);
    value.onboardingTestHash = hash; value.updatedAt = new Date();
    expect(settingsFingerprint(value)).toBe(hash);
  });
  it("rejects an unknown organization", async () => {
    mocks.organization.findUnique.mockResolvedValue(null);
    await expect(getOnboardingStatus("missing", false)).rejects.toMatchObject({ statusCode: 404 });
  });
});
