import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { simulateAssistantReply } from "../ai/tester.service.js";
import { ValidationError } from "../shared/errors.js";

const mediaSchema = z.object({
  kind: z.enum(["image", "document"]),
  simulatedKind: z.enum(["payment_proof", "product_photo", "document", "other"]).optional(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]).optional(),
  /** Fichier réel : 3 Mo maximum une fois décodé. */
  dataBase64: z.string().max(4_200_000).optional(),
  caption: z.string().trim().max(500).optional(),
});

const simulationSchema = z.object({
  booking: z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() }).nullable().optional(),
  order: z.object({ items: z.array(z.object({ quantity: z.number().int().min(1).max(999), name: z.string().max(200) })).max(20), total: z.number().nullable() }).nullable().optional(),
});

const testAgentSchema = z.object({
  message: z.string().trim().min(1, "Le message du prospect est requis.").max(4000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(30).default([]),
  simulation: simulationSchema.optional(),
  media: mediaSchema.optional(),
});

export async function aiTestRoute(app: FastifyInstance) {
  // Testeur de l'agent : simule la réponse (rendez-vous, commandes, photos, accueil, horaires) sans enregistrer de conversation ni envoyer de message ; un test réussi valide la progression du démarrage.
  app.post("/organizations/:orgId/ai-test/reply", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = testAgentSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Message de test invalide.");
    return simulateAssistantReply(orgId, {
      message: parsed.data.message,
      history: parsed.data.history,
      simulation: parsed.data.simulation,
      media: parsed.data.media,
    });
  });
}
