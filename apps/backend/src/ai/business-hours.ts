import {
  addDays,
  formatLocalDate,
  formatLocalTime,
  weekdayOf,
  zonedTimeToUtc,
  type WorkingHours,
} from "../appointments/availability.js";

export interface BusinessHoursConfig {
  enabled: boolean;
  timezone: string;
  hours: WorkingHours;
  closedMessage?: string | null | undefined;
}

export interface OpeningStatus {
  open: boolean;
  /** Prochaine ouverture (si fermé) : date locale, heure locale et libellé (« demain à 08:00 »). */
  next: { date: string; time: string; label: string } | null;
}

function toMinutes(value: string) {
  const [h, m] = value.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function dayName(date: string) {
  return DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
}

export function getOpeningStatus(config: BusinessHoursConfig, now: Date): OpeningStatus {
  const today = formatLocalDate(now, config.timezone);
  const minutes = toMinutes(formatLocalTime(now, config.timezone));
  const todayRanges = config.hours[weekdayOf(today)] ?? [];
  if (todayRanges.some((range) => toMinutes(range.start) <= minutes && minutes < toMinutes(range.end))) {
    return { open: true, next: null };
  }

  for (let offset = 0; offset <= 8; offset += 1) {
    const date = addDays(today, offset);
    const ranges = [...(config.hours[weekdayOf(date)] ?? [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    const candidate = ranges.find((range) => offset > 0 || toMinutes(range.start) > minutes);
    if (candidate) {
      const label = offset === 0 ? `aujourd'hui à ${candidate.start}` : offset === 1 ? `demain à ${candidate.start}` : `${dayName(date)} à ${candidate.start}`;
      return { open: false, next: { date, time: candidate.start, label } };
    }
  }
  return { open: false, next: null };
}

/** Résumé lisible des horaires, une ligne par jour. */
export function describeHours(hours: WorkingHours): string {
  const order: Array<[keyof WorkingHours, string]> = [["mon", "Lundi"], ["tue", "Mardi"], ["wed", "Mercredi"], ["thu", "Jeudi"], ["fri", "Vendredi"], ["sat", "Samedi"], ["sun", "Dimanche"]];
  return order
    .map(([key, label]) => {
      const ranges = hours[key] ?? [];
      return `${label} : ${ranges.length ? ranges.map((range) => `${range.start}–${range.end}`).join(" et ") : "fermé"}`;
    })
    .join("\n");
}

/** Section de prompt. null si les horaires ne sont pas activés. */
export function buildBusinessHoursPrompt(config: BusinessHoursConfig, now: Date): string | null {
  if (!config.enabled) return null;
  const status = getOpeningStatus(config, now);
  const state = status.open
    ? "L'entreprise est OUVERTE en ce moment."
    : `L'entreprise est FERMÉE en ce moment${status.next ? ` ; elle rouvre ${status.next.label} (heure locale)` : ""}.`;
  const closedRules = status.open
    ? ""
    : `
Comme l'entreprise est fermée :
- réponds quand même aux questions auxquelles tu peux répondre ;
- ne promets pas qu'une personne répondra tout de suite${status.next ? ` : dis que l'équipe sera disponible ${status.next.label}` : ""} ;
- ne dis pas « nous sommes ouverts » ni ne propose une visite immédiate.${config.closedMessage?.trim() ? `\n- consigne de l'entreprise pour les heures de fermeture : ${config.closedMessage.trim()}` : ""}`;
  return `
HORAIRES D'OUVERTURE

${state}
Horaires de l'entreprise (fuseau ${config.timezone}) :
${describeHours(config.hours)}
${closedRules}`.trim();
}

/** Les relances automatiques ne partent que pendant les heures d'ouverture (ou si les horaires ne sont pas configurés, de 8 h à 20 h). */
export function isGoodTimeToFollowUp(config: BusinessHoursConfig | null, now: Date, timezone = "Africa/Douala"): boolean {
  if (config?.enabled) return getOpeningStatus(config, now).open;
  const hour = Number(formatLocalTime(now, timezone).slice(0, 2));
  return hour >= 8 && hour < 20;
}

export { zonedTimeToUtc };
