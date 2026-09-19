import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAiOrchestrator } from "../ai/ai.factory.js";
import type { AIChatMessage } from "../ai/ai.types.js";
import { getOrCreateAiSettings } from "../ai/ai-settings.service.js";
import { buildSystemPrompt } from "../ai/prompt.js";

const testAgentSchema = z.object({
  message: z.string().trim().min(1, "Le message du prospect est requis.").max(4000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(30).default([]),
});

export async function aiTestRoute(app: FastifyInstance) {
  app.post("/organizations/:orgId/ai-test/reply", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = testAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Message de test invalide.");
    }

    const settings = await getOrCreateAiSettings(orgId);
    const history: AIChatMessage[] = [
      ...parsed.data.history,
      { role: "user", content: parsed.data.message },
    ];
    const reply = await getAiOrchestrator().getReply(
      `dashboard-test-${orgId}`,
      buildSystemPrompt(settings),
      history,
      { logRun: false },
    );

    return {
      reply: reply.reply,
      qualificationStatus: reply.qualificationStatus,
      leadScore: reply.leadScore,
      leadData: reply.leadData,
      nextAction: reply.nextAction,
    };
  });
}