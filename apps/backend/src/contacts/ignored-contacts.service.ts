import { prisma } from "../database/client.js";
import { normalizeWhatsAppNumber, formatWhatsAppNumber, sameWhatsAppNumber } from "../shared/phone.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";

export const MAX_IGNORED_CONTACTS = 200;

export async function listIgnoredContacts(organizationId: string) {
  const rows = await prisma.ignoredContact.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    whatsappNumber: row.whatsappNumber,
    displayNumber: formatWhatsAppNumber(row.whatsappNumber),
    label: row.label,
    createdAt: row.createdAt,
  }));
}

export async function addIgnoredContact(organizationId: string, input: { whatsappNumber: string; label?: string | undefined }) {
  const digits = normalizeWhatsAppNumber(input.whatsappNumber);
  if (!digits) throw new ValidationError("Numéro WhatsApp invalide.");

  const count = await prisma.ignoredContact.count({ where: { organizationId } });
  if (count >= MAX_IGNORED_CONTACTS) {
    throw new ValidationError(`Vous ne pouvez pas dépasser ${MAX_IGNORED_CONTACTS} numéros ignorés.`);
  }

  const row = await prisma.ignoredContact.upsert({
    where: { organizationId_whatsappNumber: { organizationId, whatsappNumber: digits } },
    update: { label: input.label?.trim() || null },
    create: { organizationId, whatsappNumber: digits, label: input.label?.trim() || null },
  });
  return { id: row.id, whatsappNumber: row.whatsappNumber, displayNumber: formatWhatsAppNumber(row.whatsappNumber), label: row.label, createdAt: row.createdAt };
}

export async function removeIgnoredContact(organizationId: string, id: string) {
  const result = await prisma.ignoredContact.deleteMany({ where: { id, organizationId } });
  if (result.count === 0) throw new NotFoundError("Numéro introuvable.");
}

/** Vrai si ce numéro (ou JID WhatsApp) ne doit jamais recevoir de réponse automatique. */
export async function isIgnoredNumber(organizationId: string, fromJidOrNumber: string): Promise<boolean> {
  const rows = await prisma.ignoredContact.findMany({ where: { organizationId }, select: { whatsappNumber: true } });
  return rows.some((row) => sameWhatsAppNumber(row.whatsappNumber, fromJidOrNumber));
}
