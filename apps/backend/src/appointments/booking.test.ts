import { describe, expect, it } from "vitest";
import type { AgendaConfig } from "./availability.js";
import { decideBooking, describeBookingOutcome } from "./booking.js";
import { aiReplySchema } from "../ai/schemas.js";

const config: AgendaConfig = {
  timezone: "Africa/Douala",
  slotMinutes: 30,
  bufferMinutes: 0,
  capacity: 1,
  minNoticeMinutes: 60,
  horizonDays: 14,
  workingHours: { mon: [{ start: "08:00", end: "17:00" }], tue: [{ start: "08:00", end: "17:00" }] },
  closedDates: [],
};
const now = new Date("2026-10-12T07:00:00Z"); // lundi 08:00 Douala

describe("decideBooking", () => {
  it("books a free slot", () => {
    const decision = decideBooking({
      request: { action: "book", date: "2026-10-13", time: "10:00" },
      config, now, busy: [], contactUpcoming: null,
    });
    expect(decision.kind).toBe("book");
  });

  it("refuses a slot that is already taken and proposes the nearest ones", () => {
    const taken = { id: "a", startsAt: new Date("2026-10-13T09:00:00Z"), endsAt: new Date("2026-10-13T09:30:00Z") }; // 10:00 local
    const decision = decideBooking({
      request: { action: "book", date: "2026-10-13", time: "10:00" },
      config, now, busy: [taken], contactUpcoming: null,
    });
    expect(decision.kind).toBe("unavailable");
    if (decision.kind === "unavailable") {
      expect(decision.alternatives).toHaveLength(4);
      expect(decision.alternatives.map((slot) => slot.time)).not.toContain("10:00");
      expect(decision.alternatives.map((slot) => slot.time)).toContain("09:30");
    }
  });

  it("refuses invented hours outside the agenda (Sunday, night, past)", () => {
    for (const request of [
      { action: "book" as const, date: "2026-10-18", time: "10:00" },
      { action: "book" as const, date: "2026-10-13", time: "22:00" },
      { action: "book" as const, date: "2026-10-12", time: "08:00" },
    ]) {
      expect(decideBooking({ request, config, now, busy: [], contactUpcoming: null }).kind).toBe("unavailable");
    }
  });

  it("is idempotent when the same appointment is requested twice", () => {
    const mine = { id: "m", startsAt: new Date("2026-10-13T09:00:00Z"), endsAt: new Date("2026-10-13T09:30:00Z") };
    const decision = decideBooking({
      request: { action: "book", date: "2026-10-13", time: "10:00" },
      config, now, busy: [mine], contactUpcoming: mine,
    });
    expect(decision.kind).toBe("already_booked");
  });

  it("lets a contact move their own appointment onto the slot they currently hold", () => {
    const mine = { id: "m", startsAt: new Date("2026-10-13T09:00:00Z"), endsAt: new Date("2026-10-13T09:30:00Z") };
    const decision = decideBooking({
      request: { action: "reschedule", date: "2026-10-13", time: "10:30" },
      config, now, busy: [mine], contactUpcoming: mine,
    });
    expect(decision).toMatchObject({ kind: "reschedule", appointmentId: "m" });
  });

  it("cancels the next appointment, or reports there is none", () => {
    const mine = { id: "m", startsAt: new Date("2026-10-13T09:00:00Z"), endsAt: new Date("2026-10-13T09:30:00Z") };
    expect(decideBooking({ request: { action: "cancel" }, config, now, busy: [mine], contactUpcoming: mine }).kind).toBe("cancel");
    expect(decideBooking({ request: { action: "cancel" }, config, now, busy: [], contactUpcoming: null }).kind).toBe("nothing_to_cancel");
  });

  it("asks for details when date or time is missing", () => {
    expect(decideBooking({ request: { action: "book" }, config, now, busy: [], contactUpcoming: null }).kind).toBe("invalid");
  });
});

describe("describeBookingOutcome", () => {
  it("only confirms what was really booked, and replaces the reply on conflicts", () => {
    const booked = describeBookingOutcome(
      { kind: "book", startsAt: new Date("2026-10-13T09:00:00Z"), endsAt: new Date("2026-10-13T09:30:00Z") },
      "Africa/Douala",
    );
    expect(booked.appendToReply).toContain("10:00");
    expect(booked.replaceReply).toBeNull();

    const conflict = describeBookingOutcome({ kind: "unavailable", alternatives: [] }, "Africa/Douala");
    expect(conflict.replaceReply).toContain("pas disponible");
  });
});

describe("booking field in the AI reply", () => {
  const base = {
    reply: "ok", intent: "autre", confidence: 0.9, needsHuman: false, leadScore: 0,
    qualificationStatus: "not_qualified", nextAction: "continue", leadData: {},
  };

  it("is optional and does not change replies without it", () => {
    expect(aiReplySchema.safeParse(base).success).toBe(true);
  });

  it("parses a valid booking", () => {
    const parsed = aiReplySchema.parse({ ...base, booking: { action: "book", date: "2026-10-13", time: "10:00" } });
    expect(parsed.booking).toMatchObject({ action: "book", time: "10:00" });
  });

  it("drops a malformed booking instead of invalidating the whole reply", () => {
    const parsed = aiReplySchema.safeParse({ ...base, booking: { action: "teleport", date: "demain" } });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.booking).toBeUndefined();
  });
});
