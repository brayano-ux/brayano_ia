import { z } from "zod";
import { prisma } from "../database/client.js";
import { buildAppointmentEmail, notifyOrganizationAdmins } from "../notifications/owner-notifications.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import {
  computeFreeSlots,
  formatLocalDate,
  isValidTimezone,
  summarizeSlotsByDay,
  WEEKDAY_KEYS,
  type AgendaConfig,
  type WorkingHours,
} from "./availability.js";
import {
  decideBooking,
  describeBookingOutcome,
  formatSlotLabel,
  type BookingRequest,
  type ExistingAppointment,
} from "./booking.js";

const timeOfDay = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Heure invalide (format HH:mm).");

const timeRangeSchema = z
  .object({ start: timeOfDay, end: timeOfDay })
  .refine((range) => toMin(range.start) < toMin(range.end), "L'heure de fin doit suivre l'heure de début.");

function toMin(value: string) {
  const [h, m] = value.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export const workingHoursSchema = z.object(
  Object.fromEntries(WEEKDAY_KEYS.map((key) => [key, z.array(timeRangeSchema).max(4).optional()])),
) as unknown as z.ZodType<WorkingHours>;

export const appointmentSettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  timezone: z.string().refine(isValidTimezone, "Fuseau horaire inconnu.").optional(),
  slotMinutes: z.number().int().min(10).max(240).optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  capacity: z.number().int().min(1).max(50).optional(),
  minNoticeMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  horizonDays: z.number().int().min(1).max(180).optional(),
  workingHours: workingHoursSchema.optional(),
  closedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400).optional(),
  serviceLabel: z.string().trim().max(160).nullable().optional(),
});

export type AppointmentSettingsInput = z.infer<typeof appointmentSettingsInputSchema>;

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: [{ start: "08:00", end: "17:00" }],
  tue: [{ start: "08:00", end: "17:00" }],
  wed: [{ start: "08:00", end: "17:00" }],
  thu: [{ start: "08:00", end: "17:00" }],
  fri: [{ start: "08:00", end: "17:00" }],
  sat: [{ start: "08:00", end: "13:00" }],
};

type SettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.appointmentSettings.findUnique>>>;

export function toAgendaConfig(row: SettingsRow): AgendaConfig {
  const hours = workingHoursSchema.safeParse(row.workingHours);
  const closed = z.array(z.string()).safeParse(row.closedDates ?? []);
  return {
    timezone: isValidTimezone(row.timezone) ? row.timezone : "Africa/Douala",
    slotMinutes: row.slotMinutes,
    bufferMinutes: row.bufferMinutes,
    capacity: row.capacity,
    minNoticeMinutes: row.minNoticeMinutes,
    horizonDays: row.horizonDays,
    workingHours: hours.success ? hours.data : {},
    closedDates: closed.success ? closed.data : [],
  };
}

export async function getAppointmentSettings(organizationId: string) {
  const existing = await prisma.appointmentSettings.findUnique({ where: { organizationId } });
  if (existing) return existing;
  return prisma.appointmentSettings.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId, workingHours: DEFAULT_WORKING_HOURS as object },
  });
}

export async function updateAppointmentSettings(organizationId: string, input: AppointmentSettingsInput) {
  await getAppointmentSettings(organizationId);
  const { workingHours, closedDates, ...rest } = input;
  const defined = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
  return prisma.appointmentSettings.update({
    where: { organizationId },
    data: {
      ...defined,
      ...(workingHours ? { workingHours: workingHours as object } : {}),
      ...(closedDates ? { closedDates } : {}),
    },
  });
}

export async function listAppointments(
  organizationId: string,
  range: { from?: Date; to?: Date; status?: string } = {},
) {
  return prisma.appointment.findMany({
    where: {
      organizationId,
      ...(range.status ? { status: range.status as never } : {}),
      ...(range.from || range.to
        ? { startsAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
        : {}),
    },
    orderBy: { startsAt: "asc" },
    take: 500,
  });
}

export async function updateAppointment(
  organizationId: string,
  appointmentId: string,
  input: { status?: "BOOKED" | "CANCELLED" | "DONE" | "NO_SHOW" | undefined; notes?: string | null | undefined },
) {
  const found = await prisma.appointment.findFirst({ where: { id: appointmentId, organizationId } });
  if (!found) throw new NotFoundError("Rendez-vous introuvable.");
  return prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

/** Création manuelle par le client depuis son tableau de bord (mêmes règles que l'IA). */
export async function createManualAppointment(
  organizationId: string,
  input: { date: string; time: string; contactName?: string | undefined; contactPhone?: string | undefined; service?: string | undefined; notes?: string | undefined },
) {
  const row = await getAppointmentSettings(organizationId);
  const config = toAgendaConfig(row);
  const outcome = await runInAgendaTransaction(organizationId, async (tx) => {
    const request: BookingRequest = { action: "book", date: input.date, time: input.time, service: input.service, notes: input.notes };
    const decision = decideBooking({
      request,
      config,
      now: new Date(),
      busy: await loadBusy(tx, organizationId, input.date),
      contactUpcoming: null,
    });
    if (decision.kind !== "book") return { decision, appointment: null };
    const appointment = await tx.appointment.create({
      data: {
        organizationId,
        contactName: input.contactName || null,
        contactPhone: input.contactPhone || null,
        service: input.service || row.serviceLabel || null,
        notes: input.notes || null,
        startsAt: decision.startsAt,
        endsAt: decision.endsAt,
        source: "HUMAN",
      },
    });
    return { decision, appointment };
  });
  if (!outcome.appointment) {
    throw new ValidationError(
      outcome.decision.kind === "unavailable"
        ? "Ce créneau n'est pas disponible (hors horaires, déjà pris ou trop proche)."
        : "Date ou heure invalide.",
    );
  }
  return outcome.appointment;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Verrou par entreprise : deux réservations simultanées ne peuvent pas prendre le même créneau. */
async function runInAgendaTransaction<T>(organizationId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agenda:${organizationId}`}))`;
    return work(tx);
  });
}

async function loadBusy(tx: Tx, organizationId: string, localDate: string) {
  const center = new Date(`${localDate}T12:00:00Z`);
  const rows = await tx.appointment.findMany({
    where: {
      organizationId,
      status: "BOOKED",
      startsAt: { gte: new Date(center.getTime() - 48 * 3_600_000), lte: new Date(center.getTime() + 48 * 3_600_000) },
    },
    select: { id: true, startsAt: true, endsAt: true },
  });
  return rows satisfies ExistingAppointment[];
}

export interface AgendaPrompt {
  section: string;
  config: AgendaConfig;
  serviceLabel: string | null;
}

/** Section de prompt avec l'heure actuelle et les créneaux libres. null si l'agenda est désactivé. */
export async function loadAgendaPrompt(organizationId: string, now = new Date()): Promise<AgendaPrompt | null> {
  const row = await prisma.appointmentSettings.findUnique({ where: { organizationId } });
  if (!row?.enabled) return null;
  const config = toAgendaConfig(row);

  const busy = await prisma.appointment.findMany({
    where: { organizationId, status: "BOOKED", endsAt: { gte: now } },
    select: { startsAt: true, endsAt: true },
  });
  const promptDays = Math.min(config.horizonDays, 14);
  const slots = computeFreeSlots(config, busy, now, promptDays);
  const summary = summarizeSlotsByDay(slots, config.slotMinutes);
  const today = formatLocalDate(now, config.timezone);
  const nowLabel = new Intl.DateTimeFormat("fr-FR", {
    timeZone: config.timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
      new Date(`${date}T12:00:00Z`),
    );

  const free = summary.length
    ? summary.map((day) => `- ${day.date} (${dayLabel(day.date)}) : ${day.ranges.join(", ")}`).join("\n")
    : "Aucun créneau libre sur la période.";

  const section = `
PRISE DE RENDEZ-VOUS (AGENDA ACTIVÉ)

Date et heure actuelles : ${nowLabel} (fuseau ${config.timezone}). Date d'aujourd'hui : ${today}.
Type de rendez-vous : ${row.serviceLabel ?? "rendez-vous"} — durée d'un créneau : ${config.slotMinutes} minutes.

CRÉNEAUX LIBRES (heure locale, ${promptDays} prochains jours). Une plage « 08:00–12:00 » signifie que des créneaux de ${config.slotMinutes} minutes sont libres de 08:00 jusqu'à 12:00 (le dernier se termine à 12:00).
${free}

Règles :
- Propose uniquement des créneaux de cette liste. N'invente jamais un horaire et ne promets jamais un créneau absent de la liste.
- Pour réserver, demande d'abord le jour et l'heure souhaités et le nom du prospect si inconnu, puis confirme clairement avant de réserver.
- Quand le prospect a confirmé un créneau précis, renseigne le champ "booking" : {"action":"book","date":"AAAA-MM-JJ","time":"HH:mm","service":"…"} (heure locale, 24 h). Le serveur vérifie et enregistre réellement le rendez-vous.
- Pour déplacer son prochain rendez-vous : action "reschedule" avec la nouvelle date et heure. Pour l'annuler : {"action":"cancel"}.
- N'affirme « rendez-vous confirmé » que si tu renseignes "booking" dans cette même réponse. Sans "booking", le rendez-vous n'est PAS enregistré.
- Si aucun rendez-vous n'est demandé, laisse "booking" à null.
- Si le prospect demande un horaire non listé, propose les créneaux listés les plus proches.
`.trim();

  return { section, config, serviceLabel: row.serviceLabel };
}

export interface BookingContext {
  organizationId: string;
  conversationId: string;
  contactJid: string;
  contactName?: string | null;
  contactPhone?: string | null;
}

/**
 * Applique la demande de l'IA. Ne lève jamais : en cas d'erreur on renvoie null
 * pour que la réponse WhatsApp parte quand même (l'agenda ne doit jamais bloquer l'IA).
 */
export async function applyAiBooking(
  agenda: AgendaPrompt,
  request: BookingRequest,
  context: BookingContext,
  now = new Date(),
): Promise<{ appendToReply: string | null; replaceReply: string | null } | null> {
  try {
    const decision = await runInAgendaTransaction(context.organizationId, async (tx) => {
      const referenceDate = request.date ?? formatLocalDate(now, agenda.config.timezone);
      const busy = await loadBusy(tx, context.organizationId, referenceDate);
      const upcoming = await tx.appointment.findFirst({
        where: {
          organizationId: context.organizationId,
          contactJid: context.contactJid,
          status: "BOOKED",
          startsAt: { gte: now },
        },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true, endsAt: true },
      });

      const result = decideBooking({ request, config: agenda.config, now, busy, contactUpcoming: upcoming });

      if (result.kind === "book") {
        await tx.appointment.create({
          data: {
            organizationId: context.organizationId,
            conversationId: context.conversationId,
            contactJid: context.contactJid,
            contactName: context.contactName ?? null,
            contactPhone: context.contactPhone ?? null,
            service: result.service || agenda.serviceLabel || null,
            notes: result.notes || null,
            startsAt: result.startsAt,
            endsAt: result.endsAt,
            source: "AI",
          },
        });
      } else if (result.kind === "reschedule") {
        await tx.appointment.update({
          where: { id: result.appointmentId },
          data: { startsAt: result.startsAt, endsAt: result.endsAt, ...(result.service ? { service: result.service } : {}) },
        });
      } else if (result.kind === "cancel") {
        await tx.appointment.update({ where: { id: result.appointmentId }, data: { status: "CANCELLED" } });
      }
      return result;
    });
    const kind = decision.kind === "book" ? "booked" : decision.kind === "reschedule" ? "rescheduled" : decision.kind === "cancel" ? "cancelled" : null;
    if (kind) {
      const whenLabel = decision.kind === "book" || decision.kind === "reschedule"
        ? formatSlotLabel(decision.startsAt, agenda.config.timezone)
        : null;
      void notifyOrganizationAdmins(context.organizationId, (organizationName) =>
        buildAppointmentEmail({
          organizationName,
          kind,
          prospect: { name: context.contactName, phone: context.contactPhone },
          whenLabel,
          service: ("service" in decision ? decision.service : undefined) || agenda.serviceLabel,
        }),
      );
    }
    return describeBookingOutcome(decision, agenda.config.timezone);
  } catch (error) {
    console.error(`❌ [agenda:${context.organizationId}] Échec de la réservation IA :`, error);
    return null;
  }
}
