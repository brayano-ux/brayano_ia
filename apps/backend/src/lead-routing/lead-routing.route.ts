import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createLocation,
  createResponsible,
  getCommercialMetrics,
  getRoutingSettings,
  listLocations,
  listResponsiblesForLocation,
  updateResponsible,
  deleteResponsible,
  setRoutingFallback,
} from "./lead-routing.service.js";

const createLocationSchema = z.object({
  name: z.string().min(1, "Le nom de la zone est requis."),
  city: z.string().min(1, "La ville est requise."),
  recipientWhatsApp: z.string().trim().optional().or(z.literal("")),
  active: z.boolean().optional().or(z.literal(undefined)),
});

const createResponsibleSchema = z.object({
  locationId: z.string().min(1, "La zone est requise."),
  name: z.string().min(1, "Le nom du responsable est requis."),
  whatsappNumber: z.string().min(1, "Le numéro du responsable est requis."),
  active: z.boolean().optional().or(z.literal(undefined)),
});

const updateResponsibleSchema = z.object({
  locationId: z.string().min(1, "La zone est requise.").optional(),
  name: z.string().min(1, "Le nom du responsable est requis.").optional(),
  whatsappNumber: z.string().min(1, "Le numéro du responsable est requis.").optional(),
  active: z.boolean().optional(),
}).refine((input) => Object.keys(input).length > 0, "Aucune modification fournie.");

const fallbackSchema = z.object({
  fallbackResponsibleId: z.string().nullable().optional(),
  fallbackWhatsApp: z.string().trim().nullable().optional(),
  active: z.boolean().optional().or(z.literal(undefined)),
});

export async function routingRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/routing", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const [locations, settings] = await Promise.all([listLocations(orgId), getRoutingSettings(orgId)]);
    return { locations, settings };
  });

  app.get("/organizations/:orgId/locations", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { locations: await listLocations(orgId) };
  });

  app.post("/organizations/:orgId/locations", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = createLocationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Erreur de validation de la zone.");
    }

    const location = await createLocation(orgId, parsed.data);
    return { location };
  });

  app.get("/organizations/:orgId/locations/:locationId/responsibles", async (request) => {
    const { orgId, locationId } = request.params as { orgId: string; locationId: string };
    return { responsibles: await listResponsiblesForLocation(orgId, locationId) };
  });

  app.post("/organizations/:orgId/responsibles", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = createResponsibleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Erreur de validation du responsable.");
    }

    const responsible = await createResponsible(orgId, parsed.data);
    return { responsible };
  });

  app.put("/organizations/:orgId/responsibles/:responsibleId", async (request) => {
    const { orgId, responsibleId } = request.params as { orgId: string; responsibleId: string };
    const parsed = updateResponsibleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Erreur de validation du responsable.");
    }

    const responsible = await updateResponsible(orgId, responsibleId, parsed.data);
    return { responsible };
  });

  app.delete("/organizations/:orgId/responsibles/:responsibleId", async (request) => {
    const { orgId, responsibleId } = request.params as { orgId: string; responsibleId: string };
    await deleteResponsible(orgId, responsibleId);
    return { success: true };
  });

  app.get("/organizations/:orgId/routing/fallback", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { settings: await getRoutingSettings(orgId) };
  });

  app.get("/organizations/:orgId/routing/commercial-metrics", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { commercialMetrics: await getCommercialMetrics(orgId) };
  });

  app.put("/organizations/:orgId/routing/fallback", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = fallbackSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Erreur de validation du fallback.");
    }

    const settings = await setRoutingFallback(orgId, parsed.data);
    return { settings };
  });
}
