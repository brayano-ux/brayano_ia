import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { getPlatformAdminEmails } from "../organizations/platform-admins.js";
import { requireAuth } from "./auth.route.js";
import {
  createOrganization,
  listOrganizations,
} from "../organizations/organizations.service.js";

const createOrganizationSchema = z.object({
  name: z.string().min(1, "Le nom de l'entreprise est requis."),
});

export async function organizationsRoute(app: FastifyInstance) {
  // Réservé aux administrateurs de la plateforme : le tableau de bord ne crée jamais d'entreprise vide.
  app.post("/organizations", async (request, reply) => {
    const session = await requireAuth(request.headers.authorization);
    if (!session || !getPlatformAdminEmails().includes(session.email.trim().toLowerCase())) {
      reply.code(403);
      return { message: "Action réservée à l'administrateur de la plateforme." };
    }
    const parsed = createOrganizationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message);
    }

    const organization = await createOrganization(parsed.data.name);
    return { organization };
  });

  app.get("/organizations", async (request, reply) => {
    const session = await requireAuth(request.headers.authorization);
    if (!session?.organizationId) {
      reply.code(401);
      return { message: "Non autorisé." };
    }

    const organizations = await listOrganizations(session.organizationId);
    return { organizations };
  });
}
