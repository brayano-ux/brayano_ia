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
    } = {};

    if (parsed.data.agentName !== undefined) settingsInput.agentName = parsed.data.agentName;
    if (parsed.data.businessInfo !== undefined) settingsInput.businessInfo = parsed.data.businessInfo;
    if (parsed.data.systemPrompt !== undefined) settingsInput.systemPrompt = parsed.data.systemPrompt;
    if (parsed.data.welcomeMessage !== undefined) settingsInput.welcomeMessage = parsed.data.welcomeMessage;

    const settings = await updateAiSettings(orgId, settingsInput);
    return { settings };
  });
}
