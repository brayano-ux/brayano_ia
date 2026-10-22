import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPlatformSuspension } from "../organizations/platform-suspension.service.js";
import { AppError, ValidationError } from "../shared/errors.js";
import { askSupportAssistant, checkSupportRateLimit, MAX_MESSAGE_CHARS } from "./support-assistant.js";

const bodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(MAX_MESSAGE_CHARS * 3),
  })).min(1).max(40),
});

/**
 * Assistant d'aide du tableau de bord : répond aux questions de configuration.
 * Il ne modifie rien et ne lit aucune conversation de client.
 */
export async function supportAssistantRoute(app: FastifyInstance) {
  app.post("/organizations/:orgId/support-assistant/chat", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Écrivez votre question.");
    const suspension = await getPlatformSuspension(orgId);
    if (suspension.suspended) {
      throw new AppError("Les fonctions IA sont suspendues pour cette entreprise.", 403, "AI_SUSPENDED");
    }
    checkSupportRateLimit(orgId);
    return askSupportAssistant(orgId, parsed.data.messages);
  });
}
