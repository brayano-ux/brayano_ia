import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import {
  createCorrection,
  createCorrectionFromMessage,
  deleteCorrection,
  listCorrections,
  updateCorrection,
} from "./corrections.service.js";

const correctReply = z.string().trim().min(1, "Écrivez la bonne réponse.").max(1000, "La réponse est trop longue (1 000 caractères maximum).");

const createSchema = z.object({
  question: z.string().trim().max(300).optional(),
  correctReply,
});

const fromMessageSchema = z.object({
  correctReply,
  /** Règle générale : ne dépend pas de la question du client. */
  general: z.boolean().optional(),
});

const updateSchema = z
  .object({ active: z.boolean().optional(), correctReply: correctReply.optional(), question: z.string().trim().max(300).optional() })
  .refine((input) => Object.keys(input).length > 0, "Aucune modification fournie.");

/** Ce que l'assistant a appris : corrections du propriétaire, visibles, modifiables et supprimables. */
export async function aiCorrectionsRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/ai-corrections", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { corrections: await listCorrections(orgId) };
  });

  app.post("/organizations/:orgId/ai-corrections", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { correction: await createCorrection(orgId, parsed.data) };
  });

  app.post("/organizations/:orgId/conversations/:id/messages/:messageId/correct", async (request) => {
    const { orgId, id, messageId } = request.params as { orgId: string; id: string; messageId: string };
    const parsed = fromMessageSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { correction: await createCorrectionFromMessage(orgId, id, messageId, parsed.data) };
  });

  app.put("/organizations/:orgId/ai-corrections/:correctionId", async (request) => {
    const { orgId, correctionId } = request.params as { orgId: string; correctionId: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { correction: await updateCorrection(orgId, correctionId, parsed.data) };
  });

  app.delete("/organizations/:orgId/ai-corrections/:correctionId", async (request) => {
    const { orgId, correctionId } = request.params as { orgId: string; correctionId: string };
    await deleteCorrection(orgId, correctionId);
    return { success: true };
  });
}
