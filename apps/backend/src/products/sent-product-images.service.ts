import { prisma } from "../database/client.js";

/**
 * Associe une photo de produit envoyée à son produit, pour retrouver de quoi parle le client quand il
 * répond directement à cette photo (voir whatsapp/quoted-reply.ts et whatsapp/incoming-message.ts).
 */
export async function recordSentProductImage(conversationId: string, productId: string, whatsappMessageId: string) {
  await prisma.sentProductImage.upsert({
    where: { whatsappMessageId },
    update: {},
    create: { conversationId, productId, whatsappMessageId },
  });
}

/** Produit dont la photo correspond à ce message WhatsApp, s'il y en a un. */
export async function findProductIdForSentImage(whatsappMessageId: string): Promise<string | null> {
  const row = await prisma.sentProductImage.findUnique({ where: { whatsappMessageId }, select: { productId: true } });
  return row?.productId ?? null;
}
