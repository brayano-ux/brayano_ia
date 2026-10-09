import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import {
  appointmentSettingsInputSchema,
  createManualAppointment,
  getAppointmentSettings,
  listAppointments,
  updateAppointment,
  updateAppointmentSettings,
} from "./appointments.service.js";

const manualAppointmentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{1,2}:\d{2}$/),
  contactName: z.string().trim().max(160).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  service: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(500).optional(),
});

const updateAppointmentSchema = z
  .object({
    status: z.enum(["BOOKED", "CANCELLED", "DONE", "NO_SHOW"]).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "Aucune modification fournie.");

const listQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z.enum(["BOOKED", "CANCELLED", "DONE", "NO_SHOW"]).optional(),
});

export async function appointmentsRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/appointments/settings", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { settings: await getAppointmentSettings(orgId) };
  });

  app.put("/organizations/:orgId/appointments/settings", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = appointmentSettingsInputSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { settings: await updateAppointmentSettings(orgId, parsed.data) };
  });

  app.get("/organizations/:orgId/appointments", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) throw new ValidationError("Filtre invalide.");
    return {
      appointments: await listAppointments(orgId, {
        ...(parsed.data.from ? { from: new Date(parsed.data.from) } : {}),
        ...(parsed.data.to ? { to: new Date(parsed.data.to) } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      }),
    };
  });

  app.post("/organizations/:orgId/appointments", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = manualAppointmentSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Date ou heure invalide.");
    return { appointment: await createManualAppointment(orgId, parsed.data) };
  });

  app.put("/organizations/:orgId/appointments/:appointmentId", async (request) => {
    const { orgId, appointmentId } = request.params as { orgId: string; appointmentId: string };
    const parsed = updateAppointmentSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { appointment: await updateAppointment(orgId, appointmentId, parsed.data) };
  });
}
