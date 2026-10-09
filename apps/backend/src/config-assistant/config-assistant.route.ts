import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPlatformSuspension } from "../organizations/platform-suspension.service.js";
import { AppError, ValidationError } from "../shared/errors.js";
import { analyzeSource, checkRateLimit } from "./assistant.js";
import { prepareTextSource, preparePdfSource, prepareUrlSource } from "./sources.js";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(200_000) }),
  z.object({ kind: z.literal("url"), url: z.string().max(2000) }),
]);

async function assertAllowed(organizationId: string) {
  const suspension = await getPlatformSuspension(organizationId);
  if (suspension.suspended) {
    throw new AppError("Les fonctions IA sont suspendues pour cette entreprise.", 403, "AI_SUSPENDED");
  }
  checkRateLimit(organizationId);
}

/**
 * L'analyse ne modifie JAMAIS les paramètres de l'agent : elle renvoie un brouillon
 * que le propriétaire relit, corrige puis enregistre lui-même.
 */
export async function configAssistantRoute(app: FastifyInstance) {
  app.post("/organizations/:orgId/config-assistant/analyze", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Choisissez une source : texte collé ou adresse de site.");
    await assertAllowed(orgId);
    const source = parsed.data.kind === "text" ? prepareTextSource(parsed.data.text) : await prepareUrlSource(parsed.data.url);
    return { analysis: await analyzeSource(source) };
  });

  app.post("/organizations/:orgId/config-assistant/analyze-pdf", async (request) => {
    const { orgId } = request.params as { orgId: string };
    if (!Buffer.isBuffer(request.body)) throw new ValidationError("Le fichier PDF est invalide.");
    await assertAllowed(orgId);
    return { analysis: await analyzeSource(await preparePdfSource(request.body)) };
  });
}
