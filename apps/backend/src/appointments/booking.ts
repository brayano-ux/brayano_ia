import { z } from "zod";
import {
  computeFreeSlots,
  findFreeSlot,
  formatLocalDate,
  formatLocalTime,
  zonedTimeToUtc,
  type AgendaConfig,
  type BusyInterval,
  type Slot,
} from "./availability.js";

/**
 * Demande de rendez-vous renvoyée par l'IA. Elle n'a AUCUN effet par elle-même :
 * le serveur revérifie le créneau et réserve de façon atomique.
 * `.catch(undefined)` : une demande mal formée ne doit jamais invalider
 * toute la réponse (le prospect recevrait alors la réponse de repli).
 */
export const bookingRequestSchema = z
  .object({
    action: z.enum(["book", "reschedule", "cancel"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
    service: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .nullish()
  .catch(undefined);

export type BookingRequest = NonNullable<z.infer<typeof bookingRequestSchema>>;

export interface ExistingAppointment extends BusyInterval {
  id: string;
}

export type BookingDecision =
  | { kind: "book"; startsAt: Date; endsAt: Date; service?: string | undefined; notes?: string | undefined }
  | { kind: "reschedule"; appointmentId: string; startsAt: Date; endsAt: Date; service?: string | undefined; notes?: string | undefined }
  | { kind: "cancel"; appointmentId: string }
  | { kind: "already_booked"; startsAt: Date }
  | { kind: "nothing_to_cancel" }
  | { kind: "unavailable"; alternatives: Slot[] }
  | { kind: "invalid" };

export function decideBooking(input: {
  request: BookingRequest;
  config: AgendaConfig;
  now: Date;
  /** Tous les rendez-vous BOOKED autour de la date demandée (tous contacts confondus). */
  busy: ExistingAppointment[];
  /** Prochain rendez-vous à venir du même contact, s'il existe. */
  contactUpcoming: ExistingAppointment | null;
}): BookingDecision {
  const { request, config, now, busy, contactUpcoming } = input;

  if (request.action === "cancel") {
    return contactUpcoming
      ? { kind: "cancel", appointmentId: contactUpcoming.id }
      : { kind: "nothing_to_cancel" };
  }

  if (!request.date || !request.time) return { kind: "invalid" };
  const startsAt = zonedTimeToUtc(request.date, request.time, config.timezone);
  if (!startsAt) return { kind: "invalid" };

  const moving = request.action === "reschedule" ? contactUpcoming : null;
  const others = moving ? busy.filter((appointment) => appointment.id !== moving.id) : busy;

  // Idempotence : l'IA répète parfois la même réservation sur deux messages.
  if (request.action === "book" && contactUpcoming?.startsAt.getTime() === startsAt.getTime()) {
    return { kind: "already_booked", startsAt };
  }

  const slot = findFreeSlot(config, others, now, startsAt);
  if (!slot) {
    const requestedMs = startsAt.getTime();
    const alternatives = computeFreeSlots(config, others, now, 14)
      .sort((a, b) => Math.abs(a.startsAt.getTime() - requestedMs) - Math.abs(b.startsAt.getTime() - requestedMs))
      .slice(0, 4)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return { kind: "unavailable", alternatives };
  }

  const common = { startsAt: slot.startsAt, endsAt: slot.endsAt, service: request.service, notes: request.notes };
  return moving
    ? { kind: "reschedule", appointmentId: moving.id, ...common }
    : { kind: "book", ...common };
}

export function formatSlotLabel(startsAt: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(startsAt);
  return `${day} ${formatLocalTime(startsAt, timezone)}`;
}

/**
 * Texte ajouté à la réponse de l'IA. Le serveur est la seule source de vérité
 * sur ce qui est réellement réservé ; ces messages sont volontairement
 * bilingues (FR/EN) car le serveur ne sait pas dans quelle langue écrit le prospect.
 */
export function describeBookingOutcome(
  decision: BookingDecision,
  timezone: string,
): { appendToReply: string | null; replaceReply: string | null } {
  switch (decision.kind) {
    case "book":
    case "reschedule":
      return {
        appendToReply: `✅ Rendez-vous confirmé / Appointment confirmed : ${formatSlotLabel(decision.startsAt, timezone)}`,
        replaceReply: null,
      };
    case "already_booked":
      return {
        appendToReply: `✅ Rendez-vous déjà enregistré / Already booked : ${formatSlotLabel(decision.startsAt, timezone)}`,
        replaceReply: null,
      };
    case "cancel":
      return { appendToReply: "✅ Rendez-vous annulé / Appointment cancelled.", replaceReply: null };
    case "nothing_to_cancel":
      return {
        appendToReply: null,
        replaceReply: "Je ne trouve aucun rendez-vous à annuler. / I can't find any appointment to cancel.",
      };
    case "unavailable": {
      const options = decision.alternatives.map((slot) => `• ${formatSlotLabel(slot.startsAt, timezone)}`).join("\n");
      return {
        appendToReply: null,
        replaceReply: decision.alternatives.length
          ? `Désolé, ce créneau n'est pas disponible. Voici des horaires libres :\n${options}\n\nLequel vous convient ?\n\nSorry, that slot is not available. Which of the times above suits you?`
          : "Désolé, ce créneau n'est pas disponible et je n'ai pas d'autre horaire libre pour le moment. Un membre de l'équipe vous recontactera. / Sorry, that slot is not available and no other time is free right now. Our team will get back to you.",
      };
    }
    case "invalid":
      return {
        appendToReply: null,
        replaceReply: "Pouvez-vous préciser la date et l'heure souhaitées ? / Could you tell me the date and time you would like?",
      };
  }
}

export function localDateTimeOf(startsAt: Date, timezone: string) {
  return { date: formatLocalDate(startsAt, timezone), time: formatLocalTime(startsAt, timezone) };
}
