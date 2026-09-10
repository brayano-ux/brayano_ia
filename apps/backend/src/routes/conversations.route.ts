import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getConversationWithMessages,
  listConversations,
  recordOutboundMessage,
  setConversationAiEnabled,
} from "../conversations/conversations.service.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { sendWhatsAppMessageForOrg } from "../whatsapp/whatsapp.registry.js";

const replyBodySchema = z.object({
  text: z.string().min(1, "Le texte de la réponse ne peut pas être vide."),
});

/**
 * Récupère la conversation et vérifie qu'elle appartient bien à l'organisation
 * demandée dans l'URL — c'est ici que se joue l'isolation multi-tenant pour
 * ces routes (jamais via le prompt, jamais par confiance dans le client).
 */
async function getOwnedConversationOrThrow(orgId: string, conversationId: string) {
  const conversation = await getConversationWithMessages(conversationId);
  if (!conversation || conversation.organizationId !== orgId) {
    throw new NotFoundError("Conversation introuvable pour cette entreprise.");
  }
  return conversation;
}

export async function conversationsRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/conversations", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const conversations = await listConversations(orgId);
    return { conversations };
  });

  app.get("/organizations/:orgId/conversations/:id", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    const conversation = await getOwnedConversationOrThrow(orgId, id);
    return { conversation };
  });

  // Route temporaire (Phase 4) : permet à un humain de répondre manuellement
  // via l'API, en complément de l'IA (utile pour le takeover humain).
  app.post("/organizations/:orgId/conversations/:id/reply", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    const parsed = replyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message);
    }

    const conversation = await getOwnedConversationOrThrow(orgId, id);

    await sendWhatsAppMessageForOrg(orgId, conversation.contact.whatsappJid, parsed.data.text);
    const message = await recordOutboundMessage({
      conversationId: conversation.id,
      text: parsed.data.text,
      author: "HUMAN",
    });

    return { message };
  });

  app.post("/organizations/:orgId/conversations/:id/ai/enable", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    await getOwnedConversationOrThrow(orgId, id);
    const conversation = await setConversationAiEnabled(id, true);
    return { conversation };
  });

  app.post("/organizations/:orgId/conversations/:id/ai/disable", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    await getOwnedConversationOrThrow(orgId, id);
    const conversation = await setConversationAiEnabled(id, false);
    return { conversation };
  });
}
