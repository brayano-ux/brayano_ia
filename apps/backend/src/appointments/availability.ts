/**
 * Calcul des créneaux libres d'un agenda — fonctions pures (aucun accès base,
 * aucune dépendance), donc entièrement testables.
 *
 * Les heures d'ouverture sont exprimées en heure locale de l'entreprise
 * (fuseau IANA, par défaut Africa/Douala). Tout est converti en UTC via Intl.
 */

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export interface TimeRange {
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

export type WorkingHours = Partial<Record<WeekdayKey, TimeRange[]>>;

export interface AgendaConfig {
  timezone: string;
  slotMinutes: number;
  bufferMinutes: number;
  capacity: number;
  minNoticeMinutes: number;
  horizonDays: number;
  workingHours: WorkingHours;
  closedDates: string[]; // "YYYY-MM-DD"
}

export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  date: string; // "YYYY-MM-DD" (local)
  time: string; // "HH:mm" (local)
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(timezone: string, utcMs: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function offsetMs(timezone: string, utcMs: number): number {
  const p = zonedParts(timezone, utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convertit une heure murale locale (dans `timezone`) en instant UTC. */
export function zonedTimeToUtc(
  date: string,
  time: string,
  timezone: string,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])];
  const [hour, minute] = [Number(timeMatch[1]), Number(timeMatch[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = offsetMs(timezone, guess);
  let utc = guess - firstOffset;
  const secondOffset = offsetMs(timezone, utc);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  return new Date(utc);
}

export function formatLocalDate(utc: Date, timezone: string): string {
  const p = zonedParts(timezone, utc.getTime());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function formatLocalTime(utc: Date, timezone: string): string {
  const p = zonedParts(timezone, utc.getTime());
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function weekdayOf(date: string): WeekdayKey {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return WEEKDAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function isFree(
  config: AgendaConfig,
  busy: BusyInterval[],
  startMs: number,
  endMs: number,
): boolean {
  const buffer = config.bufferMinutes * MINUTE;
  // Un rendez-vous occupe [début, fin + tampon[ ; le nouveau créneau aussi.
  const concurrent = busy.filter((interval) =>
    overlaps(startMs, endMs + buffer, interval.startsAt.getTime(), interval.endsAt.getTime() + buffer),
  ).length;
  return concurrent < Math.max(1, config.capacity);
}

/** Créneaux d'une journée locale donnée (hors filtre « préavis » et « horizon »). */
function slotsForDate(config: AgendaConfig, busy: BusyInterval[], date: string): Slot[] {
  if (config.closedDates.includes(date)) return [];
  const ranges = config.workingHours[weekdayOf(date)] ?? [];
  const slots: Slot[] = [];
  const length = Math.max(5, config.slotMinutes);

  for (const range of ranges) {
    const open = toMinutes(range.start);
    const close = toMinutes(range.end);
    for (let minute = open; minute + length <= close; minute += length) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const startsAt = zonedTimeToUtc(date, time, config.timezone);
      if (!startsAt) continue;
      const endsAt = new Date(startsAt.getTime() + length * MINUTE);
      if (isFree(config, busy, startsAt.getTime(), endsAt.getTime())) {
        slots.push({ startsAt, endsAt, date, time });
      }
    }
  }
  return slots;
}

/** Créneaux libres, réservables maintenant, sur les `days` prochains jours locaux. */
export function computeFreeSlots(
  config: AgendaConfig,
  busy: BusyInterval[],
  now: Date,
  days = config.horizonDays,
): Slot[] {
  const today = formatLocalDate(now, config.timezone);
  const earliest = now.getTime() + config.minNoticeMinutes * MINUTE;
  const horizonEnd = now.getTime() + config.horizonDays * DAY;
  const result: Slot[] = [];

  for (let offset = 0; offset < Math.min(days, config.horizonDays + 1); offset += 1) {
    for (const slot of slotsForDate(config, busy, addDays(today, offset))) {
      if (slot.startsAt.getTime() >= earliest && slot.startsAt.getTime() <= horizonEnd) {
        result.push(slot);
      }
    }
  }
  return result;
}

/** Vrai si `startsAt` est exactement le début d'un créneau libre et réservable. */
export function findFreeSlot(
  config: AgendaConfig,
  busy: BusyInterval[],
  now: Date,
  startsAt: Date,
): Slot | null {
  const date = formatLocalDate(startsAt, config.timezone);
  const earliest = now.getTime() + config.minNoticeMinutes * MINUTE;
  if (startsAt.getTime() < earliest || startsAt.getTime() > now.getTime() + config.horizonDays * DAY) {
    return null;
  }
  return slotsForDate(config, busy, date).find((slot) => slot.startsAt.getTime() === startsAt.getTime()) ?? null;
}

/** Regroupe les créneaux consécutifs d'un jour en plages lisibles (« 08:00–12:00 »). */
export function summarizeSlotsByDay(slots: Slot[], slotMinutes: number): Array<{ date: string; ranges: string[] }> {
  const byDay = new Map<string, Slot[]>();
  for (const slot of slots) {
    byDay.set(slot.date, [...(byDay.get(slot.date) ?? []), slot]);
  }

  return [...byDay.entries()].map(([date, daySlots]) => {
    const ranges: string[] = [];
    let rangeStart = daySlots[0]!;
    let previous = daySlots[0]!;
    const close = (last: Slot) => {
      const end = formatEnd(last, slotMinutes);
      ranges.push(rangeStart.time === last.time ? `${rangeStart.time}` : `${rangeStart.time}–${end}`);
    };
    for (const slot of daySlots.slice(1)) {
      if (slot.startsAt.getTime() - previous.startsAt.getTime() !== slotMinutes * MINUTE) {
        close(previous);
        rangeStart = slot;
      }
      previous = slot;
    }
    close(previous);
    return { date, ranges };
  });
}

function formatEnd(slot: Slot, slotMinutes: number): string {
  const minute = toMinutes(slot.time) + slotMinutes;
  return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
