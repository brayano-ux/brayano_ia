import { env } from "../config/env.js";
import { prisma } from "../database/client.js";
import { deleteClientMediaFile } from "./client-media.service.js";

/**
 * Les photos et documents reçus ne sont pas gardés éternellement (disque limité, données de clients) :
 * au-delà de CLIENT_MEDIA_RETENTION_DAYS, le fichier est supprimé ; le message reste dans la conversation.
 */
export async function cleanupOldClientMedia(now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - env.CLIENT_MEDIA_RETENTION_DAYS * 24 * 3600_000);
  let removed = 0;
  for (;;) {
    const batch = await prisma.message.findMany({
      where: { mediaFile: { not: null }, createdAt: { lt: limit } },
      select: { id: true, mediaFile: true, conversation: { select: { organizationId: true } } },
      take: 200,
    });
    if (!batch.length) return removed;
    for (const message of batch) {
      try {
        if (message.mediaFile) await deleteClientMediaFile(message.conversation.organizationId, message.mediaFile);
        await prisma.message.update({ where: { id: message.id }, data: { mediaFile: null } });
        removed += 1;
      } catch (error) {
        console.error(`❌ Nettoyage du fichier du message ${message.id} impossible :`, error);
        return removed;
      }
    }
  }
}
