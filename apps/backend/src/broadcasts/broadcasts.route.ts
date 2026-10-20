import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { getWhatsAppAccountStatus, sendWhatsAppMessageForOrg } from "../whatsapp/whatsapp.registry.js";
import { BROADCAST_LIMITS } from "./broadcast-rules.js";
import { cancelBroadcast, createBroadcast, getBroadcast, listBroadcasts, previewBroadcast, runBroadcast } from "./broadcasts.service.js";

const stageSchema = z.enum(["NEW", "INTERESTED", "ORDERED", "CALLBACK"]);

const audienceQuerySchema = z.object({
  stages: z.string().optional().transform((value) => (value ? value.split(",").filter(Boolean) : [])).pipe(z.array(stageSchema).max(4)),
  days: z.coerce.number().int().min(1).max(BROADCAST_LIMITS.maxWindowDays).optional(),
  text: z.string().max(BROADCAST_LIMITS.maxTextLength).optional(),
});

const previewBodySchema = z.object({
  stages: z.array(stageSchema).max(4).optional(),
  windowDays: z.number().int().min(1).max(BROADCAST_LIMITS.maxWindowDays).optional(),
  text: z.string().max(BROADCAST_LIMITS.maxTextLength).optional(),
});

const createSchema = z.object({
  text: z.string().trim().min(1, "Écrivez le message à envoyer.").max(BROADCAST_LIMITS.maxTextLength, `Le message est trop long (${BROADCAST_LIMITS.maxTextLength} caractères maximum).`),
  stages: z.array(stageSchema).max(4).optional(),
  windowDays: z.number().int().min(1).max(BROADCAST_LIMITS.maxWindowDays).optional(),
});

export const whatsappBroadcastDeps = {
  isConnected: (organizationId: string) => getWhatsAppAccountStatus(organizationId) === "CONNECTED",
  send: (organizationId: string, jid: string, text: string) => sendWhatsAppMessageForOrg(organizationId, jid, text),
};

export async function broadcastsRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/broadcasts", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { broadcasts: await listBroadcasts(orgId), limits: BROADCAST_LIMITS };
  });

  app.get("/organizations/:orgId/broadcasts/preview", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = audienceQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) throw new ValidationError("Critères invalides.");
    return { preview: await previewBroadcast(orgId, { stages: parsed.data.stages, windowDays: parsed.data.days, text: parsed.data.text }) };
  });

  // Même aperçu, avec le texte dans le corps de la requête (un long message ne tient pas toujours dans une adresse).
  app.post("/organizations/:orgId/broadcasts/preview", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = previewBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError("Critères invalides.");
    return { preview: await previewBroadcast(orgId, parsed.data) };
  });

  app.post("/organizations/:orgId/broadcasts", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    if (!whatsappBroadcastDeps.isConnected(orgId)) throw new ValidationError("Connectez d'abord votre WhatsApp (onglet WhatsApp) avant d'envoyer des messages.");
    const broadcast = await createBroadcast(orgId, { text: parsed.data.text, stages: parsed.data.stages, windowDays: parsed.data.windowDays });
    void runBroadcast(broadcast.id, whatsappBroadcastDeps);
    return { broadcast };
  });

  app.get("/organizations/:orgId/broadcasts/:id", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    return { broadcast: await getBroadcast(orgId, id) };
  });

  app.post("/organizations/:orgId/broadcasts/:id/cancel", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    return { broadcast: await cancelBroadcast(orgId, id) };
  });
}
