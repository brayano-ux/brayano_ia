import { createHash } from "node:crypto";
import { prisma } from "../database/client.js";
import type { AiSettings } from "../generated/prisma/client.js";
import { NotFoundError } from "../shared/errors.js";

/** Only response settings participate: recording a test must not invalidate that same test. */
export function settingsFingerprint(settings: AiSettings): string {
  return createHash("sha256").update(JSON.stringify([
    settings.agentName, settings.businessInfo, settings.systemPrompt, settings.welcomeMessage,
    settings.qualificationFields, settings.businessHoursEnabled,
    settings.businessHours, settings.businessTimezone, settings.closedMessage,
  ])).digest("hex");
}

/** Save only proof of a successful test, never its messages. Ignore a test of settings changed in the meantime. */
export async function markAgentTested(settings: AiSettings) {
  const hash = settingsFingerprint(settings);
  if (settings.onboardingTestHash === hash) return;
  await prisma.aiSettings.updateMany({
    where: { organizationId: settings.organizationId, updatedAt: settings.updatedAt },
    data: { onboardingTestHash: hash },
  });
}

export async function getOnboardingStatus(organizationId: string, whatsappConnected: boolean) {
  const [organization, firstReply] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { platformSuspended: true, aiSettings: true } }),
    // These records are created after WhatsApp confirms delivery, unlike simulator replies or human messages.
    prisma.message.findFirst({ where: { conversation: { organizationId }, direction: "OUTBOUND", author: "AI" }, select: { id: true } }),
  ]);
  if (!organization) throw new NotFoundError("Entreprise introuvable.");
  const settings = organization.aiSettings;
  return {
    profileComplete: Boolean(settings?.businessInfo?.trim() && settings.systemPrompt.trim() && settings.agentName.trim()),
    testComplete: Boolean(firstReply || (settings?.onboardingTestHash && settings.onboardingTestHash === settingsFingerprint(settings))),
    whatsappConnected,
    firstReplySent: Boolean(firstReply),
    aiEnabled: Boolean(settings?.aiEnabled),
    suspended: organization.platformSuspended,
  };
}
