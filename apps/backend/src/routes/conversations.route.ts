import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getConversationWithMessages,
  listConversationSummaries,
  listProspectsForExport,
  markConversationRead,
  recordOutboundMessage,
  setConversationAiEnabled,
  setConversationStage,
  setPaymentCheckPending,
} from "../conversations/conversations.service.js";
import { STAGE_LABELS } from "../conversations/stage.js";
import { buildClientMediaPath, clientMediaResponseHeaders, readClientMedia, verifyClientMediaToken } from "../media/client-media.service.js";
import { prisma } from "../database/client.js";
import { setContactOptOut } from "../contacts/contacts.service.js";
import { requireAuth } from "./auth.route.js";
import { withConversationSendLock } from "../conversations/conversation-send-lock.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { sendWhatsAppMessageForOrg } from "../whatsapp/whatsapp.registry.js";

const stageBodySchema = z.object({
  stage: z.enum(["NEW", "INTERESTED", "ORDERED", "CALLBACK", "AUTO"]),
});

const listQuerySchema = z.object({
  stage: z.enum(["NEW", "INTERESTED", "ORDERED", "CALLBACK"]).optional(),
  q: z.string().trim().max(80).optional(),
});

/** Ajoute à chaque message le lien signé (temporaire) de son fichier, sans jamais exposer le nom du fichier stocké. */
function withMediaUrls<T extends { mediaFile?: string | null }>(organizationId: string, messages: T[]) {
  return messages.map(({ mediaFile, ...message }) => ({
    ...message,
    mediaUrl: mediaFile ? buildClientMediaPath(organizationId, mediaFile) : null,
  }));
}

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
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.issues[0]?.message);
    const conversations = await listConversationSummaries(orgId, { stage: query.data.stage, search: query.data.q });
    return { conversations, stageLabels: STAGE_LABELS };
  });

  app.get("/organizations/:orgId/prospects/export", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const conversations = await listProspectsForExport(orgId);
    return { conversations };
  });

  app.get("/organizations/:orgId/conversations/:id", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    const conversation = await getOwnedConversationOrThrow(orgId, id);
    return { conversation: { ...conversation, messages: withMediaUrls(orgId, conversation.messages) } };
  });

  app.post("/organizations/:orgId/conversations/:id/read", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    await getOwnedConversationOrThrow(orgId, id);
    await markConversationRead(orgId, id);
    return { success: true };
  });

  app.post("/organizations/:orgId/conversations/:id/opt-out", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    const parsed = z.object({ optedOut: z.boolean() }).safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Choix invalide.");
    const conversation = await getOwnedConversationOrThrow(orgId, id);
    await setContactOptOut(orgId, conversation.contactId, parsed.data.optedOut);
    return { optedOut: parsed.data.optedOut };
  });

  // « J'ai vérifié le paiement » : efface le signalement « preuve de paiement à vérifier » (ou le remet).
  app.post("/organizations/:orgId/conversations/:id/payment-check", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    const parsed = z.object({ pending: z.boolean() }).safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Choix invalide.");
    await getOwnedConversationOrThrow(orgId, id);
    await setPaymentCheckPending(id, parsed.data.pending);
    return { paymentCheckPending: parsed.data.pending };
  });

  app.post("/organizations/:orgId/conversations/:id/stage", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    const parsed = stageBodySchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Étiquette invalide.");
    return { conversation: await setConversationStage(orgId, id, parsed.data.stage) };
  });

  // Fichier reçu d'un client : lien signé et temporaire (voir shared/public-route.ts), pas de jeton de connexion.
  app.get("/media/client/:orgId/:filename", async (request, reply) => {
    const { orgId, filename } = request.params as { orgId: string; filename: string };
    const token = (request.query as { t?: string } | undefined)?.t;
    if (!/^[0-9a-f-]{36}$/i.test(orgId) || !verifyClientMediaToken(orgId, filename, typeof token === "string" ? token : undefined)) {
      reply.code(403);
      return { message: "Accès interdit à ce fichier." };
    }
    const [contents, message] = await Promise.all([
      readClientMedia(orgId, filename),
      prisma.message.findFirst({ where: { mediaFile: filename, conversation: { organizationId: orgId } }, select: { mediaMimeType: true, mediaName: true } }),
    ]);
    if (!contents || !message) {
      reply.code(404);
      return { message: "Fichier introuvable." };
    }
    return reply.headers(clientMediaResponseHeaders(message.mediaMimeType, message.mediaName, filename)).send(contents);
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
    // Plusieurs personnes partagent la boîte : on garde qui a répondu.
    const session = await requireAuth(request.headers.authorization);

    const message = await withConversationSendLock(id, async () => {
      await setConversationAiEnabled(id, false);
      await sendWhatsAppMessageForOrg(orgId, conversation.contact.whatsappJid, parsed.data.text);
      return recordOutboundMessage({
        conversationId: conversation.id,
        text: parsed.data.text,
        author: "HUMAN",
        ...(session?.name ? { aiMeta: { sentBy: session.name } } : {}),
      });
    });
    return { message };
  });

  app.post("/organizations/:orgId/conversations/:id/ai/enable", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    // Le propriétaire peut toujours rendre la main à l'IA : le délai de 24 h ne concerne que la
    // reprise AUTOMATIQUE (au prochain message du prospect), jamais ce bouton.
    const conversation = await withConversationSendLock(id, async () => {
      await getOwnedConversationOrThrow(orgId, id);
      return setConversationAiEnabled(id, true);
    });
    return { conversation };
  });

  app.post("/organizations/:orgId/conversations/:id/ai/disable", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    await getOwnedConversationOrThrow(orgId, id);
    const conversation = await withConversationSendLock(id, () => setConversationAiEnabled(id, false));
    return { conversation };
  });
}
