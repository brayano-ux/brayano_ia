import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addIgnoredContact, listIgnoredContacts, removeIgnoredContact } from "./ignored-contacts.service.js";
import { ValidationError } from "../shared/errors.js";

const addSchema = z.object({
  whatsappNumber: z.string().trim().min(1, "Le numéro est requis."),
  label: z.string().trim().max(60).optional(),
});

/** Contacts à ignorer : numéros (famille, fournisseurs…) auxquels l'IA ne doit jamais répondre automatiquement. */
export async function ignoredContactsRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/ignored-contacts", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { contacts: await listIgnoredContacts(orgId) };
  });

  app.post("/organizations/:orgId/ignored-contacts", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = addSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { contact: await addIgnoredContact(orgId, parsed.data) };
  });

  app.delete("/organizations/:orgId/ignored-contacts/:id", async (request) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    await removeIgnoredContact(orgId, id);
    return { success: true };
  });
}
