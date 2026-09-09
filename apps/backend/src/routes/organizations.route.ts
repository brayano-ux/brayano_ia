import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import {
  createOrganization,
  listOrganizations,
} from "../organizations/organizations.service.js";

const createOrganizationSchema = z.object({
  name: z.string().min(1, "Le nom de l'entreprise est requis."),
});

export async function organizationsRoute(app: FastifyInstance) {
  app.post("/organizations", async (request) => {
    const parsed = createOrganizationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message);
    }

    const organization = await createOrganization(parsed.data.name);
    return { organization };
  });

  app.get("/organizations", async () => {
    const organizations = await listOrganizations();
    return { organizations };
  });
}
