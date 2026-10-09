import { describe, expect, it } from "vitest";
import {
  computeFreeSlots,
  findFreeSlot,
  formatLocalDate,
  formatLocalTime,
  summarizeSlotsByDay,
  zonedTimeToUtc,
  type AgendaConfig,
} from "./availability.js";

const config: AgendaConfig = {
  timezone: "Africa/Douala", // UTC+1, sans heure d'été
  slotMinutes: 30,
  bufferMinutes: 0,
  capacity: 1,
  minNoticeMinutes: 60,
  horizonDays: 14,
  workingHours: {
    mon: [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "17:00" }],
    tue: [{ start: "08:00", end: "10:00" }],
  },
  closedDates: [],
};

// Lundi 12 octobre 2026, 07:00 UTC = 08:00 à Douala.
const monday = new Date("2026-10-12T07:00:00Z");

describe("zonedTimeToUtc", () => {
  it("converts Douala wall time to UTC", () => {
    expect(zonedTimeToUtc("2026-10-12", "09:00", "Africa/Douala")?.toISOString()).toBe("2026-10-12T08:00:00.000Z");
  });

  it("handles daylight saving time zones", () => {
    expect(zonedTimeToUtc("2026-07-01", "09:00", "America/New_York")?.toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedTimeToUtc("2026-01-15", "09:00", "America/New_York")?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("rejects impossible dates and times", () => {
    expect(zonedTimeToUtc("2026-02-30", "09:00", "Africa/Douala")).toBeNull();
    expect(zonedTimeToUtc("2026-10-12", "25:00", "Africa/Douala")).toBeNull();
    expect(zonedTimeToUtc("not-a-date", "09:00", "Africa/Douala")).toBeNull();
  });

  it("round-trips through the local formatters", () => {
    const utc = zonedTimeToUtc("2026-10-12", "23:30", "Africa/Douala")!;
    expect(formatLocalDate(utc, "Africa/Douala")).toBe("2026-10-12");
    expect(formatLocalTime(utc, "Africa/Douala")).toBe("23:30");
  });
});

describe("computeFreeSlots", () => {
  it("lists slots inside opening hours only, respecting minimum notice", () => {
    const slots = computeFreeSlots(config, [], monday, 1);
    // Préavis 60 min : 08:00 → premier créneau possible 09:00.
    expect(slots[0]?.time).toBe("09:00");
    expect(slots.map((slot) => slot.time)).not.toContain("12:00");
    expect(slots.map((slot) => slot.time)).not.toContain("13:00");
    expect(slots.at(-1)?.time).toBe("16:30");
  });

  it("skips closed days and days without opening hours", () => {
    const withClosure = { ...config, closedDates: ["2026-10-13"] };
    const slots = computeFreeSlots(withClosure, [], monday, 3);
    expect(slots.some((slot) => slot.date === "2026-10-13")).toBe(false); // fermé
    expect(slots.some((slot) => slot.date === "2026-10-14")).toBe(false); // mercredi non configuré
  });

  it("removes booked slots", () => {
    const busy = [{ startsAt: new Date("2026-10-12T08:00:00Z"), endsAt: new Date("2026-10-12T08:30:00Z") }]; // 09:00 local
    const times = computeFreeSlots(config, busy, monday, 1).map((slot) => slot.time);
    expect(times).not.toContain("09:00");
    expect(times).toContain("09:30");
  });

  it("applies the buffer after an appointment", () => {
    const buffered = { ...config, bufferMinutes: 30 };
    const busy = [{ startsAt: new Date("2026-10-12T08:00:00Z"), endsAt: new Date("2026-10-12T08:30:00Z") }]; // 09:00-09:30
    const times = computeFreeSlots(buffered, busy, monday, 1).map((slot) => slot.time);
    expect(times).not.toContain("09:30"); // tampon
    expect(times).not.toContain("08:30");
    expect(times).toContain("10:00");
  });

  it("supports several simultaneous appointments (capacity)", () => {
    const twoChairs = { ...config, capacity: 2 };
    const one = [{ startsAt: new Date("2026-10-12T08:00:00Z"), endsAt: new Date("2026-10-12T08:30:00Z") }];
    expect(computeFreeSlots(twoChairs, one, monday, 1).map((slot) => slot.time)).toContain("09:00");
    const two = [...one, ...one];
    expect(computeFreeSlots(twoChairs, two, monday, 1).map((slot) => slot.time)).not.toContain("09:00");
  });

  it("never offers slots beyond the horizon", () => {
    const short = { ...config, horizonDays: 1 };
    const slots = computeFreeSlots(short, [], monday, 30);
    expect(slots.every((slot) => slot.startsAt.getTime() <= monday.getTime() + 24 * 3600_000)).toBe(true);
  });
});

describe("findFreeSlot", () => {
  it("accepts only exact slot starts that are free", () => {
    const ok = zonedTimeToUtc("2026-10-12", "10:00", config.timezone)!;
    const misaligned = zonedTimeToUtc("2026-10-12", "10:10", config.timezone)!;
    const lunch = zonedTimeToUtc("2026-10-12", "12:30", config.timezone)!;
    const past = zonedTimeToUtc("2026-10-12", "08:00", config.timezone)!;
    expect(findFreeSlot(config, [], monday, ok)).not.toBeNull();
    expect(findFreeSlot(config, [], monday, misaligned)).toBeNull();
    expect(findFreeSlot(config, [], monday, lunch)).toBeNull();
    expect(findFreeSlot(config, [], monday, past)).toBeNull();
  });
});

describe("summarizeSlotsByDay", () => {
  it("groups consecutive slots into readable ranges", () => {
    const slots = computeFreeSlots(config, [], monday, 1);
    const [day] = summarizeSlotsByDay(slots, 30);
    expect(day?.ranges).toEqual(["09:00–12:00", "14:00–17:00"]);
  });
});
