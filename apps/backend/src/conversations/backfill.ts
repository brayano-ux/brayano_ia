import { prisma } from "../database/client.js";

/**
 * Remplit les champs de suivi (dernier message du client, étiquette) pour les conversations créées AVANT leur existence.
 * Sans effet sur les conversations déjà à jour ni sur les étiquettes fixées à la main. Sûr à relancer à chaque démarrage.
 */
export async function backfillConversationTracking() {
  const lastInbound = await prisma.$executeRaw`
    UPDATE conversations c SET last_inbound_at = m.last_at
    FROM (SELECT conversation_id, max(created_at) AS last_at FROM messages WHERE direction = 'INBOUND' GROUP BY conversation_id) m
    WHERE c.id = m.conversation_id AND c.last_inbound_at IS NULL`;
  const ordered = await prisma.$executeRaw`
    UPDATE conversations SET stage = 'ORDERED'
    WHERE stage <> 'ORDERED' AND stage_locked = false AND (
      id IN (SELECT conversation_id FROM orders WHERE conversation_id IS NOT NULL AND status <> 'CANCELLED')
      OR id IN (SELECT conversation_id FROM appointments WHERE conversation_id IS NOT NULL AND status <> 'CANCELLED'))`;
  const interested = await prisma.$executeRaw`
    UPDATE conversations SET stage = 'INTERESTED'
    WHERE stage = 'NEW' AND stage_locked = false AND qualification_status <> 'NOT_QUALIFIED'`;
  return { lastInbound, ordered, interested };
}
