import { DEFAULT_RESPONSE_DELAY_SECONDS } from "../ai/ai-settings.service.js";
import { hashPassword } from "../auth/password.js";
import { setCustomPlan, type CustomPlanSettings } from "../billing/subscription.service.js";
import { env } from "../config/env.js";
import { prisma } from "../database/client.js";
import { ValidationError } from "../shared/errors.js";
import { normalizeWhatsAppNumber } from "../shared/phone.js";

export interface NewCustomClient {
  companyName: string;
  ownerName: string;
  email: string;
  /** Mot de passe provisoire, communiqué au client par l'administrateur ; il peut le changer avec « Mot de passe oublié ? ». */
  password: string;
  whatsappNumber?: string | undefined;
  plan: CustomPlanSettings;
}

/**
 * Crée l'entreprise et le compte de son propriétaire directement en formule sur mesure, sans code par email ni essai gratuit :
 * c'est l'administrateur de la plateforme qui installe le client et lui remet ses identifiants.
 */
export async function createCustomClient(input: NewCustomClient) {
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new ValidationError("Cette adresse email est déjà utilisée par un autre compte.");
  }
  let whatsappNumber: string | null = null;
  if (input.whatsappNumber?.trim()) {
    whatsappNumber = normalizeWhatsAppNumber(input.whatsappNumber);
    if (!whatsappNumber) throw new ValidationError("Numéro WhatsApp invalide : indiquez-le avec l'indicatif du pays (ex. +237 6 90 00 00 00).");
  }
  const passwordHash = await hashPassword(input.password);
  const organization = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({ data: { name: input.companyName.trim(), whatsappNumber, freeAiResponsesRemaining: 0 } });
    await tx.user.create({ data: { organizationId: created.id, name: input.ownerName.trim(), email, passwordHash, role: "ADMIN" } });
    await tx.aiSettings.create({
      data: { organizationId: created.id, agentName: env.AI_AGENT_NAME, systemPrompt: env.AI_SYSTEM_PROMPT, responseDelaySeconds: DEFAULT_RESPONSE_DELAY_SECONDS },
    });
    return created;
  });
  const billing = await setCustomPlan(organization.id, input.plan);
  return { organizationId: organization.id, name: organization.name, owner: { name: input.ownerName.trim(), email }, billing };
}
