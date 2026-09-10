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
