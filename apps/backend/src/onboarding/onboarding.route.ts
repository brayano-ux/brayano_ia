import type { FastifyInstance } from "fastify";
import { getWhatsAppAccountStatus } from "../whatsapp/whatsapp.registry.js";
import { getOnboardingStatus } from "./onboarding.service.js";

export async function onboardingRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/onboarding", async request => {
    const { orgId } = request.params as { orgId: string };
    return { onboarding: await getOnboardingStatus(orgId, getWhatsAppAccountStatus(orgId) === "CONNECTED") };
  });
}
