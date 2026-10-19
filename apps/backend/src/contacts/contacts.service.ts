import { prisma } from "../database/client.js";

export async function findOrCreateContact(organizationId: string, whatsappJid: string) {
  const existing = await prisma.contact.findUnique({
    where: {
      organizationId_whatsappJid: { organizationId, whatsappJid },
    },
  });
  if (existing) return existing;

  return prisma.contact.create({
    data: { organizationId, whatsappJid },
  });
}

/** « STOP » du client, ou choix du propriétaire : plus de relances ni de messages groupés pour ce contact. */
export async function setContactOptOut(organizationId: string, contactId: string, optedOut: boolean) {
  const result = await prisma.contact.updateMany({
    where: { id: contactId, organizationId },
    data: { optedOut, optedOutAt: optedOut ? new Date() : null },
  });
  return result.count > 0;
}
