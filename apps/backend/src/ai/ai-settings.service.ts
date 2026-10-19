import { env } from "../config/env.js";
import { prisma } from "../database/client.js";
import { NotFoundError } from "../shared/errors.js";
import type { WorkingHours } from "../appointments/availability.js";

export const RESPONSE_DELAY_OPTIONS = [3, 5, 7, 60, 120] as const;
export const DEFAULT_RESPONSE_DELAY_SECONDS = 3;

export type ResponseDelaySeconds = (typeof RESPONSE_DELAY_OPTIONS)[number];

export const DEFAULT_FOLLOW_UP_DELAY_HOURS = 24;

export interface AiSettingsInput {
  agentName?: string | undefined;
  businessInfo?: string | undefined;
  agentImageUrl?: string | undefined;
  systemPrompt?: string | undefined;
  welcomeMessage?: string | undefined;
  qualificationFields?: string[] | undefined;
  aiEnabled?: boolean | undefined;
  responseDelaySeconds?: number | undefined;
  businessHoursEnabled?: boolean | undefined;
  businessHours?: WorkingHours | undefined;
  businessTimezone?: string | undefined;
  closedMessage?: string | null | undefined;
  followUpEnabled?: boolean | undefined;
  followUpDelayHours?: number | undefined;
  followUpMax?: number | undefined;
}

export function resolveResponseDelaySeconds(value: unknown): ResponseDelaySeconds {
  if (value === 60 || value === 120) return value;
  if (value === 5 || value === 7) return value;
  return DEFAULT_RESPONSE_DELAY_SECONDS;
}

/**
 * Base de connaissances simple (Phase 0 : pas de RAG/PDF pour le MVP,
 * un texte structuré suffit). Chaque entreprise a ses propres réglages,
 * créés avec des valeurs par défaut génériques à la première demande.
 */
export async function getOrCreateAiSettings(organizationId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) {
    throw new NotFoundError("Entreprise introuvable.");
  }

  const existing = await prisma.aiSettings.findUnique({ where: { organizationId } });
  if (existing) return existing;

  return prisma.aiSettings.create({
    data: {
      organizationId,
      agentName: env.AI_AGENT_NAME,
      systemPrompt: env.AI_SYSTEM_PROMPT,
      agentImageUrl: null,
      responseDelaySeconds: DEFAULT_RESPONSE_DELAY_SECONDS,
    },
  });
}

export async function updateAiSettings(organizationId: string, input: AiSettingsInput) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) {
    throw new NotFoundError("Entreprise introuvable.");
  }

  const updatePayload = {
    ...(input.agentName !== undefined ? { agentName: input.agentName } : {}),
    ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.businessInfo !== undefined ? { businessInfo: input.businessInfo || null } : {}),
    ...(input.agentImageUrl !== undefined ? { agentImageUrl: input.agentImageUrl || null } : {}),
    ...(input.welcomeMessage !== undefined ? { welcomeMessage: input.welcomeMessage || null } : {}),
    ...(input.qualificationFields !== undefined ? { qualificationFields: input.qualificationFields } : {}),
    ...(input.aiEnabled !== undefined ? { aiEnabled: input.aiEnabled } : {}),
    ...(input.responseDelaySeconds !== undefined
      ? { responseDelaySeconds: resolveResponseDelaySeconds(input.responseDelaySeconds) }
      : {}),
    ...(input.businessHoursEnabled !== undefined ? { businessHoursEnabled: input.businessHoursEnabled } : {}),
    ...(input.businessHours !== undefined ? { businessHours: input.businessHours as object } : {}),
    ...(input.businessTimezone !== undefined ? { businessTimezone: input.businessTimezone } : {}),
    ...(input.closedMessage !== undefined ? { closedMessage: input.closedMessage?.trim() || null } : {}),
    ...(input.followUpEnabled !== undefined ? { followUpEnabled: input.followUpEnabled } : {}),
    ...(input.followUpDelayHours !== undefined ? { followUpDelayHours: input.followUpDelayHours } : {}),
    ...(input.followUpMax !== undefined ? { followUpMax: input.followUpMax } : {}),
  };

  return prisma.aiSettings.upsert({
    where: { organizationId },
    update: updatePayload,
    create: {
      organizationId,
      agentName: input.agentName ?? env.AI_AGENT_NAME,
      systemPrompt: input.systemPrompt ?? env.AI_SYSTEM_PROMPT,
      businessInfo: input.businessInfo ?? null,
      agentImageUrl: input.agentImageUrl ?? null,
      welcomeMessage: input.welcomeMessage ?? null,
      qualificationFields: input.qualificationFields ?? [],
      aiEnabled: input.aiEnabled ?? true,
      responseDelaySeconds: resolveResponseDelaySeconds(input.responseDelaySeconds),
      ...updatePayload,
    },
  });
}
