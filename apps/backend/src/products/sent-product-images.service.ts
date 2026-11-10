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

/** Dernier produit dont une photo a été envoyée dans cette conversation : « l'article qu'on m'a envoyé », quand le client n'en dit pas plus. */
export async function findLatestSentProductId(conversationId: string): Promise<string | null> {
  const row = await prisma.sentProductImage.findFirst({ where: { conversationId }, orderBy: { createdAt: "desc" }, select: { productId: true } });
  return row?.productId ?? null;
}

/** Produit dont la photo correspond à ce message WhatsApp, s'il y en a un. */
export async function findProductIdForSentImage(whatsappMessageId: string): Promise<string | null> {
  const row = await prisma.sentProductImage.findUnique({ where: { whatsappMessageId }, select: { productId: true } });
  return row?.productId ?? null;
}

/** Produits dont une photo a été envoyée récemment dans cette conversation (du plus récent au plus ancien, sans doublon). */
export async function findRecentSentProductIds(conversationId: string, take = 6): Promise<string[]> {
  const rows = await prisma.sentProductImage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: take * 2, select: { productId: true } });
  return [...new Set(rows.map((row) => row.productId))].slice(0, take);
}
