import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getOrCreateAiSettings,
  updateAiSettings,
} from "../ai/ai-settings.service.js";
import { ValidationError } from "../shared/errors.js";

const updateAiSettingsSchema = z.object({
  agentName: z.string().min(1).optional(),
  businessInfo: z.string().optional(),
  systemPrompt: z.string().min(1).optional(),
  welcomeMessage: z.string().optional(),
  qualificationFields: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  aiEnabled: z.boolean().optional(),
  responseDelaySeconds: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(60), z.literal(120)]).optional(),
});

export async function aiSettingsRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/ai-settings", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const settings = await getOrCreateAiSettings(orgId);
    return { settings };
  });

  app.put("/organizations/:orgId/ai-settings", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = updateAiSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message);
    }

    const settingsInput: {
      agentName?: string | undefined;
      businessInfo?: string | undefined;
      systemPrompt?: string | undefined;
      welcomeMessage?: string | undefined;
      qualificationFields?: string[] | undefined;
      aiEnabled?: boolean | undefined;
      responseDelaySeconds?: 3 | 5 | 7 | 60 | 120 | undefined;
    } = {};

    if (parsed.data.agentName !== undefined) settingsInput.agentName = parsed.data.agentName;
    if (parsed.data.businessInfo !== undefined) settingsInput.businessInfo = parsed.data.businessInfo;
    if (parsed.data.systemPrompt !== undefined) settingsInput.systemPrompt = parsed.data.systemPrompt;
    if (parsed.data.welcomeMessage !== undefined) settingsInput.welcomeMessage = parsed.data.welcomeMessage;
    if (parsed.data.qualificationFields !== undefined) settingsInput.qualificationFields = parsed.data.qualificationFields;
    if (parsed.data.aiEnabled !== undefined) settingsInput.aiEnabled = parsed.data.aiEnabled;
    if (parsed.data.responseDelaySeconds !== undefined) {
      settingsInput.responseDelaySeconds = parsed.data.responseDelaySeconds;
    }

    const settings = await updateAiSettings(orgId, settingsInput);
    return { settings };
  });
}
