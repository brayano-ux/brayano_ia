import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../routes/auth.route.js";
import { ValidationError } from "../shared/errors.js";
import { addAgent, listTeam, MAX_TEAM_MEMBERS, removeAgent, resetAgentPassword, setAgentActive } from "./team.service.js";

const password = z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères.").max(100);

const addSchema = z.object({
  name: z.string().trim().min(2, "Le nom est requis.").max(80),
  email: z.string().trim().email("Adresse email invalide."),
  password,
});

/** Équipe : le propriétaire ajoute des employés qui partagent la boîte de réception (voir shared/permissions.ts pour leurs droits). */
export async function teamRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/team", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { members: await listTeam(orgId), maxMembers: MAX_TEAM_MEMBERS };
  });

  app.post("/organizations/:orgId/team", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = addSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { member: await addAgent(orgId, parsed.data) };
  });

  app.put("/organizations/:orgId/team/:userId", async (request) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    const parsed = z.object({ active: z.boolean().optional(), password: password.optional() }).refine((input) => input.active !== undefined || input.password !== undefined, "Aucune modification fournie.").safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    const session = await requireAuth(request.headers.authorization);
    if (parsed.data.password) await resetAgentPassword(orgId, userId, parsed.data.password, session?.userId);
    if (parsed.data.active !== undefined) return { member: await setAgentActive(orgId, userId, parsed.data.active, session?.userId) };
    return { success: true };
  });

  app.delete("/organizations/:orgId/team/:userId", async (request) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    const session = await requireAuth(request.headers.authorization);
    await removeAgent(orgId, userId, session?.userId);
    return { success: true };
  });
}
