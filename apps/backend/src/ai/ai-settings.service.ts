import { env } from "../config/env.js";
import { prisma } from "../database/client.js";

export interface AiSettingsInput {
  agentName?: string | undefined;
  businessInfo?: string | undefined;
  systemPrompt?: string | undefined;
  welcomeMessage?: string | undefined;
  responseDelaySeconds?: number | undefined;
}

const ALLOWED_RESPONSE_DELAYS = [5, 7, 10] as const;

function normalizeResponseDelay(value?: number): number {
  if (value === undefined) return 5;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || !ALLOWED_RESPONSE_DELAYS.includes(normalized as (typeof ALLOWED_RESPONSE_DELAYS)[number])) {
    return 5;
  }
  return normalized;
}

/**
 * Base de connaissances simple (Phase 0 : pas de RAG/PDF pour le MVP,
 * un texte structuré suffit). Chaque entreprise a ses propres réglages,
 * créés avec des valeurs par défaut génériques à la première demande.
 */
export async function getOrCreateAiSettings(organizationId: string) {
  const existing = await prisma.aiSettings.findUnique({ where: { organizationId } });
  if (existing) return existing;

  return prisma.aiSettings.create({
    data: {
      organizationId,
      agentName: env.AI_AGENT_NAME,
      systemPrompt: env.AI_SYSTEM_PROMPT,
      responseDelaySeconds: 5,
    },
  });
}

export async function updateAiSettings(organizationId: string, input: AiSettingsInput) {
  const updatePayload = {
    ...(input.agentName !== undefined ? { agentName: input.agentName } : {}),
    ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.businessInfo !== undefined ? { businessInfo: input.businessInfo || null } : {}),
    ...(input.welcomeMessage !== undefined ? { welcomeMessage: input.welcomeMessage || null } : {}),
    ...(input.responseDelaySeconds !== undefined ? { responseDelaySeconds: normalizeResponseDelay(input.responseDelaySeconds) } : {}),
  };

  return prisma.aiSettings.upsert({
    where: { organizationId },
    update: updatePayload,
    create: {
      organizationId,
      agentName: input.agentName ?? env.AI_AGENT_NAME,
      systemPrompt: input.systemPrompt ?? env.AI_SYSTEM_PROMPT,
      businessInfo: input.businessInfo ?? null,
      welcomeMessage: input.welcomeMessage ?? null,
      responseDelaySeconds: normalizeResponseDelay(input.responseDelaySeconds),
    },
  });
}
