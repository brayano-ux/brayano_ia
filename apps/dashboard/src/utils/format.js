import { splitWhatsAppNumber } from "./francophone-countries.js";

export function initials(name = "?") {
  return (
    String(name)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export function formatTime(dateValue) {
  if (!dateValue) return "—";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatDateTime(dateValue) {
  if (!dateValue) return "—";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return String(dateValue);

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeTime(dateValue) {
  if (!dateValue) return "—";
  const delta = Date.now() - new Date(dateValue).getTime();
  const minutes = Math.max(0, Math.round(delta / 60000));

  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;

  const days = Math.round(hours / 24);
  return `${days} j`;
}

export function formatExportDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("fr-FR");
}

export function formatFullDate(date = new Date()) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatClock(date = new Date()) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** Nombre avec séparateur de milliers français (espace insécable) : 12 500. */
export function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value) || 0).replace(/ /g, " ");
}

/** Montant en francs CFA : 12 500 FCFA. */
export function formatMoney(value) {
  return `${formatNumber(value)} FCFA`;
}

/** Nombre abrégé pour les graduations d'un graphique : 12 k, 1,2 M. */
export function formatCompact(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) < 10_000) return formatNumber(number);
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(number).replace(/ /g, " ");
}

/** « 1 client », « 3 clients » : accorde le nom avec le nombre. */
export function plural(count, one, many) {
  return `${formatNumber(count)} ${count > 1 ? many : one}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Heure d'un message dans une liste, comme dans une messagerie : « 14:32 », « Hier », « lun. », « 12 nov. ». */
export function formatListTime(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (sameDay(date, now)) return formatTime(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Hier";
  if (now.getTime() - date.getTime() < 6 * 24 * 3600_000) return new Intl.DateTimeFormat("fr-FR", { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() ? { year: "2-digit" } : {}) }).format(date);
}

/** Intitulé de jour pour séparer les messages d'une conversation : « Aujourd'hui », « Hier », « Lundi 12 novembre ». */
export function formatDayLabel(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (sameDay(date, now)) return "Aujourd'hui";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Hier";
  const text = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Numéro WhatsApp lisible à partir d'un identifiant « 237690112233@s.whatsapp.net » : « +237 690 11 22 33 ».
 * L'indicatif est reconnu pour les pays de la liste ; sinon le numéro est simplement groupé par blocs.
 */
export function formatPhone(jidOrNumber) {
  const digits = String(jidOrNumber || "").split("@")[0].replace(/\D/g, "");
  if (!digits) return "";
  const split = splitWhatsAppNumber(digits);
  const group = (value) => value.replace(/(\d{3})(?=\d)/, "$1 ").replace(/(\d{2})(?=(\d{2})+$)/g, "$1 ").trim();
  if (split) return `+${split.dialCode} ${split.local.length % 2 ? group(split.local) : split.local.replace(/(\d{2})(?=\d)/g, "$1 ")}`;
  return `+${digits.replace(/(\d{3})(?=\d)/g, "$1 ")}`;
}
