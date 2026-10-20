import { prisma } from "../database/client.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { formatWhatsAppNumber, normalizeWhatsAppNumber, sameWhatsAppNumber } from "../shared/phone.js";

export interface WhatsAppNumberInfo {
  /** Numéro de l'entreprise donné à l'inscription (chiffres avec indicatif), ou null pour un ancien compte. */
  declaredNumber: string | null;
  declaredDisplay: string | null;
  /** Numéro réellement lié au WhatsApp connecté (chiffres), ou null tant qu'aucun téléphone n'a été relié. */
  connectedNumber: string | null;
  /** false quand le téléphone relié n'est pas celui que l'entreprise a déclaré ; null si on ne peut pas comparer. */
  numberMatches: boolean | null;
}

export async function getWhatsAppNumberInfo(organizationId: string): Promise<WhatsAppNumberInfo> {
  const [organization, account] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { whatsappNumber: true } }),
    prisma.whatsAppAccount.findFirst({ where: { organizationId }, orderBy: { updatedAt: "desc" }, select: { phoneNumber: true } }),
  ]);
  const declaredNumber = organization?.whatsappNumber ?? null;
  const connectedNumber = account?.phoneNumber ? account.phoneNumber.split("@")[0]!.split(":")[0]!.replace(/\D/g, "") || null : null;
  return {
    declaredNumber,
    declaredDisplay: declaredNumber ? formatWhatsAppNumber(declaredNumber) : null,
    connectedNumber,
    numberMatches: declaredNumber && connectedNumber ? sameWhatsAppNumber(declaredNumber, connectedNumber) : null,
  };
}

/** Enregistre le numéro WhatsApp de l'entreprise (comptes créés avant l'ajout du champ, ou changement de numéro). */
export async function setDeclaredWhatsAppNumber(organizationId: string, input: string) {
  const whatsappNumber = normalizeWhatsAppNumber(input);
  if (!whatsappNumber) {
    throw new ValidationError("Numéro WhatsApp invalide : indiquez-le avec l'indicatif du pays (ex. +237 6 90 00 00 00).");
  }
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Entreprise introuvable.");
  await prisma.organization.update({ where: { id: organizationId }, data: { whatsappNumber } });
  return getWhatsAppNumberInfo(organizationId);
}
