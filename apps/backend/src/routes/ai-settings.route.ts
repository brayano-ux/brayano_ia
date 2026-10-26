import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getOrCreateAiSettings,
  markPersonaSeen,
  updateAiSettings,
} from "../ai/ai-settings.service.js";
import { isValidTimezone } from "../appointments/availability.js";
import { workingHoursSchema } from "../appointments/appointments.service.js";
import { getPlatformSuspension } from "../organizations/platform-suspension.service.js";
import { BUSINESS_INFO_MAX_LENGTH } from "../ai/settings-limits.js";
import { ValidationError } from "../shared/errors.js";
import { assertAcceptableImageUrl } from "../whatsapp/public-image.js";

const validMediaUrl = z
  .string()
  .trim()
  .superRefine((value, context) => {
    if (!value) return;
    try {
      assertAcceptableImageUrl(value);
    } catch (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Adresse d'image refusée." });
    }
  });

const updateAiSettingsSchema = z.object({
  agentName: z.string().min(1).optional(),
  businessInfo: z.string().max(BUSINESS_INFO_MAX_LENGTH, "Les informations sur votre activité ne doivent pas dépasser 50 000 caractères.").optional(),
  agentImageUrl: validMediaUrl.optional().or(z.literal("")),
  systemPrompt: z.string().min(1).optional(),
  welcomeMessage: z.string().optional(),
  qualificationFields: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  aiEnabled: z.boolean().optional(),
  responseDelaySeconds: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(60), z.literal(120)]).optional(),
  businessHoursEnabled: z.boolean().optional(),
  businessHours: workingHoursSchema.optional(),
  businessTimezone: z.string().refine(isValidTimezone, "Fuseau horaire inconnu.").optional(),
  closedMessage: z.string().trim().max(500).nullable().optional(),
  followUpEnabled: z.boolean().optional(),
  followUpDelayHours: z.number().int().min(2).max(72).optional(),
  followUpMax: z.number().int().min(1).max(2).optional(),
  agentDomain: z.string().trim().max(60).optional(),
  agentRole: z.string().trim().max(60).optional(),
  agentTone: z.string().trim().max(60).optional(),
  topicGateEnabled: z.boolean().optional(),
  topicGateTopic: z.string().trim().max(200).nullable().optional(),
});

export async function aiSettingsRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/ai-settings", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const settings = await getOrCreateAiSettings(orgId);
    const suspension = await getPlatformSuspension(orgId);
    return { settings, platformSuspension: suspension };
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
      agentImageUrl?: string | undefined;
      systemPrompt?: string | undefined;
      welcomeMessage?: string | undefined;
      qualificationFields?: string[] | undefined;
      aiEnabled?: boolean | undefined;
      responseDelaySeconds?: 3 | 5 | 7 | 60 | 120 | undefined;
      businessHoursEnabled?: boolean | undefined;
      businessHours?: z.infer<typeof workingHoursSchema> | undefined;
      businessTimezone?: string | undefined;
      closedMessage?: string | null | undefined;
      followUpEnabled?: boolean | undefined;
      followUpDelayHours?: number | undefined;
      followUpMax?: number | undefined;
      agentDomain?: string | undefined;
      agentRole?: string | undefined;
      agentTone?: string | undefined;
      topicGateEnabled?: boolean | undefined;
      topicGateTopic?: string | null | undefined;
    } = {};

    if (parsed.data.agentName !== undefined) settingsInput.agentName = parsed.data.agentName;
    if (parsed.data.businessInfo !== undefined) settingsInput.businessInfo = parsed.data.businessInfo;
    if (parsed.data.agentImageUrl !== undefined) settingsInput.agentImageUrl = parsed.data.agentImageUrl || undefined;
    if (parsed.data.systemPrompt !== undefined) settingsInput.systemPrompt = parsed.data.systemPrompt;
    if (parsed.data.welcomeMessage !== undefined) settingsInput.welcomeMessage = parsed.data.welcomeMessage;
    if (parsed.data.qualificationFields !== undefined) settingsInput.qualificationFields = parsed.data.qualificationFields;
    if (parsed.data.aiEnabled !== undefined) settingsInput.aiEnabled = parsed.data.aiEnabled;
    if (parsed.data.responseDelaySeconds !== undefined) {
      settingsInput.responseDelaySeconds = parsed.data.responseDelaySeconds;
    }

    if (parsed.data.businessHoursEnabled !== undefined) settingsInput.businessHoursEnabled = parsed.data.businessHoursEnabled;
    if (parsed.data.businessHours !== undefined) settingsInput.businessHours = parsed.data.businessHours;
    if (parsed.data.businessTimezone !== undefined) settingsInput.businessTimezone = parsed.data.businessTimezone;
    if (parsed.data.closedMessage !== undefined) settingsInput.closedMessage = parsed.data.closedMessage;
    if (parsed.data.followUpEnabled !== undefined) settingsInput.followUpEnabled = parsed.data.followUpEnabled;
    if (parsed.data.followUpDelayHours !== undefined) settingsInput.followUpDelayHours = parsed.data.followUpDelayHours;
    if (parsed.data.followUpMax !== undefined) settingsInput.followUpMax = parsed.data.followUpMax;
    if (parsed.data.agentDomain !== undefined) settingsInput.agentDomain = parsed.data.agentDomain;
    if (parsed.data.agentRole !== undefined) settingsInput.agentRole = parsed.data.agentRole;
    if (parsed.data.agentTone !== undefined) settingsInput.agentTone = parsed.data.agentTone;
    if (parsed.data.topicGateEnabled !== undefined) settingsInput.topicGateEnabled = parsed.data.topicGateEnabled;
    if (parsed.data.topicGateTopic !== undefined) settingsInput.topicGateTopic = parsed.data.topicGateTopic;

    const settings = await updateAiSettings(orgId, settingsInput);
    return { settings };
  });

  app.post("/organizations/:orgId/ai-settings/persona-seen", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await markPersonaSeen(orgId);
    return { success: true };
  });
}
