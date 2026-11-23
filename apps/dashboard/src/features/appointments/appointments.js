import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { formatPhone } from "../../utils/format.js";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONES } from "../../utils/labels.js";
import { confirmDialog } from "../../ui/confirm.js";
import { closeDrawer, openDrawer } from "../../ui/drawer.js";
import { icon } from "../../ui/icons.js";

/**
 * Rendez-vous : l'agenda (regroupé par jour, avec les actions du moment) et ses réglages
 * (créneaux, horaires, jours fermés). L'agent ne propose que les créneaux libres calculés par le serveur.
 */

const DAYS = [
  ["mon", "Lundi"],
  ["tue", "Mardi"],
  ["wed", "Mercredi"],
  ["thu", "Jeudi"],
  ["fri", "Vendredi"],
  ["sat", "Samedi"],
  ["sun", "Dimanche"],
];

let settings = null;
let closedDates = [];
let appointments = [];
let cleanAgendaSnapshot = "";

const base = () => `/organizations/${getState().organizationId}/appointments`;
const timezone = () => settings?.timezone || "Africa/Douala";

function renderHoursRows() {
  $("#agenda-hours-rows").innerHTML = DAYS.map(([key, label]) => {
    const ranges = settings?.workingHours?.[key] || [];
    const [first = {}, second = {}] = ranges;
    return `
      <div class="agenda-hours-row" data-day="${key}">
        <span class="agenda-day">${label}</span>
        <div class="agenda-range">
          <input type="time" data-field="s1" value="${escapeHtml(first.start || "")}" aria-label="${label} — début" />
          <span>→</span>
          <input type="time" data-field="e1" value="${escapeHtml(first.end || "")}" aria-label="${label} — fin" />
        </div>
        <div class="agenda-range">
          <input type="time" data-field="s2" value="${escapeHtml(second.start || "")}" aria-label="${label} — reprise" />
          <span>→</span>
          <input type="time" data-field="e2" value="${escapeHtml(second.end || "")}" aria-label="${label} — fin" />
        </div>
      </div>`;
  }).join("");
}

function formatClosedDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

function renderClosedDates() {
  const container = $("#agenda-closed-list");
  container.innerHTML = closedDates.length
    ? closedDates.map((date) => `<span class="agenda-chip">${icon("calendar-x", "icon-sm")}${escapeHtml(formatClosedDate(date))}<button type="button" data-remove-closed="${escapeHtml(date)}" aria-label="Retirer ${escapeHtml(formatClosedDate(date))}">${icon("close", "icon-xs")}</button></span>`).join("")
    : '<span class="muted">Aucun jour fermé pour le moment.</span>';
  container.querySelectorAll("[data-remove-closed]").forEach((button) => {
    button.onclick = () => {
      closedDates = closedDates.filter((date) => date !== button.dataset.removeClosed);
      renderClosedDates();
      refreshDirty();
    };
  });
}

function fillSettingsForm() {
  $("#agenda-enabled").checked = Boolean(settings.enabled);
  $("#agenda-service").value = settings.serviceLabel || "";
  $("#agenda-slot").value = settings.slotMinutes;
  $("#agenda-buffer").value = settings.bufferMinutes;
  $("#agenda-capacity").value = settings.capacity;
  $("#agenda-notice").value = settings.minNoticeMinutes;
  $("#agenda-horizon").value = settings.horizonDays;
  $("#agenda-timezone").value = settings.timezone;
  closedDates = Array.isArray(settings.closedDates) ? [...settings.closedDates] : [];
  renderHoursRows();
  renderClosedDates();
  cleanAgendaSnapshot = agendaSnapshot();
  refreshDirty();
}

function agendaSnapshot() {
  return JSON.stringify([
    $("#agenda-enabled").checked, $("#agenda-service").value, $("#agenda-slot").value, $("#agenda-buffer").value,
    $("#agenda-capacity").value, $("#agenda-notice").value, $("#agenda-horizon").value, $("#agenda-timezone").value,
    readWorkingHours(), closedDates,
  ]);
}

/** L'utilisateur quitte la page sans enregistrer : les réglages reviennent à leur dernier état enregistré. */
export function discardAgendaChanges() {
  if (settings) fillSettingsForm();
  else cleanAgendaSnapshot = "";
  refreshDirty();
}

/** Vrai si les réglages de l'agenda ont été modifiés sans être enregistrés. */
export function hasUnsavedAgendaChanges() {
  return Boolean(cleanAgendaSnapshot) && agendaSnapshot() !== cleanAgendaSnapshot;
}

function refreshDirty() {
  $("#agenda-dirty")?.classList.toggle("hidden", !hasUnsavedAgendaChanges());
}

function readWorkingHours() {
  const hours = {};
  document.querySelectorAll(".agenda-hours-row").forEach((row) => {
    const value = (field) => row.querySelector(`[data-field="${field}"]`).value;
    const ranges = [];
    if (value("s1") && value("e1")) ranges.push({ start: value("s1"), end: value("e1") });
    if (value("s2") && value("e2")) ranges.push({ start: value("s2"), end: value("e2") });
    hours[row.dataset.day] = ranges;
  });
  return hours;
}

async function saveSettings(event) {
  event.preventDefault();
  const button = $("#agenda-save");
  button.disabled = true;
  button.classList.add("is-loading");
  try {
    const result = await api(`${base()}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        enabled: $("#agenda-enabled").checked,
        serviceLabel: $("#agenda-service").value.trim() || null,
        slotMinutes: Number($("#agenda-slot").value),
        bufferMinutes: Number($("#agenda-buffer").value),
        capacity: Number($("#agenda-capacity").value),
        minNoticeMinutes: Number($("#agenda-notice").value),
        horizonDays: Number($("#agenda-horizon").value),
        timezone: $("#agenda-timezone").value.trim() || "Africa/Douala",
        workingHours: readWorkingHours(),
        closedDates,
      }),
    });
    settings = result.settings;
    fillSettingsForm();
    showToast("Agenda enregistré.", "success");
  } catch (error) {
    showToast(error.message || "Impossible d’enregistrer l’agenda.", "error");
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
  }
}

function localDay(value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatWhen(startsAt) {
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: timezone(), weekday: "long", day: "numeric", month: "long" }).format(new Date(startsAt));
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: timezone(), hour: "2-digit", minute: "2-digit" }).format(new Date(startsAt));
  return { date: date.charAt(0).toUpperCase() + date.slice(1), time };
}

/** « Aujourd'hui », « Demain », « Hier » devant la date, pour se repérer d'un coup d'œil. */
function dayHeading(startsAt) {
  const day = localDay(startsAt);
  const today = localDay(Date.now());
  const tomorrow = localDay(Date.now() + 24 * 3600_000);
  const yesterday = localDay(Date.now() - 24 * 3600_000);
  const relative = day === today ? "Aujourd'hui" : day === tomorrow ? "Demain" : day === yesterday ? "Hier" : "";
  return { relative, date: formatWhen(startsAt).date, isToday: day === today };
}

function appointmentMarkup(appointment) {
  const name = appointment.contactName || (appointment.contactPhone ? formatPhone(appointment.contactPhone) : "Client WhatsApp");
  const meta = [appointment.service, appointment.contactPhone && appointment.contactName ? formatPhone(appointment.contactPhone) : ""].filter(Boolean).join(" · ");
  return `
    <article class="appointment-card status-${escapeHtml(String(appointment.status).toLowerCase())}">
      <strong class="appointment-time num">${escapeHtml(formatWhen(appointment.startsAt).time)}</strong>
      <div class="appointment-info">
        <span class="appointment-name truncate">${escapeHtml(name)}</span>
        <small class="truncate">${escapeHtml(meta)}</small>
        <span class="appointment-source">${icon(appointment.source === "AI" ? "sparkles" : "user", "icon-xs")}${appointment.source === "AI" ? "Pris par l’agent" : "Ajouté à la main"}</span>
      </div>
      <span class="badge ${APPOINTMENT_STATUS_TONES[appointment.status] || "neutral"} appointment-status">${escapeHtml(APPOINTMENT_STATUS_LABELS[appointment.status] || appointment.status)}</span>
      ${appointment.status === "BOOKED" ? `
        <div class="appointment-actions">
          <button type="button" class="btn btn-sm btn-secondary" data-appt="${escapeHtml(appointment.id)}" data-status="DONE">${icon("check")}Terminé</button>
          <button type="button" class="btn btn-sm btn-ghost" data-appt="${escapeHtml(appointment.id)}" data-status="NO_SHOW">${icon("user-x")}Absent</button>
          <button type="button" class="btn btn-sm btn-ghost btn-danger-ghost" data-appt="${escapeHtml(appointment.id)}" data-status="CANCELLED">${icon("close")}Annuler</button>
        </div>` : ""}
    </article>`;
}

function renderAppointments() {
  const container = $("#appointments-list");
  const active = appointments.filter((appointment) => appointment.status === "BOOKED");
  const count = $("#appointments-count");
  count.textContent = String(active.length);
  count.classList.toggle("hidden", !active.length);

  if (!appointments.length) {
    const disabled = settings && !settings.enabled;
    container.innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon("calendar")}</span><p class="empty-title">Aucun rendez-vous à venir</p><p class="empty-text">${disabled ? "La prise de rendez-vous par l'agent est désactivée. Activez-la dans les réglages de l'agenda pour qu'il propose vos créneaux." : "Quand un client réservera sur WhatsApp, son rendez-vous apparaîtra ici. Vous pouvez aussi en ajouter un vous-même."}</p><button type="button" class="btn btn-secondary" data-add-appointment>${icon("calendar-plus")}Ajouter un rendez-vous</button></div></div>`;
    $("[data-add-appointment]", container).onclick = openAddForm;
    return;
  }

  const groups = new Map();
  for (const appointment of appointments) {
    const key = localDay(appointment.startsAt);
    groups.set(key, [...(groups.get(key) || []), appointment]);
  }

  container.innerHTML = [...groups.values()].map((items) => {
    const heading = dayHeading(items[0].startsAt);
    return `
    <section class="card appointment-day${heading.isToday ? " is-today" : ""}">
      <header class="appointment-day-head">
        <h2>${heading.relative ? `<span>${heading.relative}</span>` : ""}${escapeHtml(heading.date)}</h2>
        <small>${items.length} rendez-vous</small>
      </header>
      ${items.map(appointmentMarkup).join("")}
    </section>`;
  }).join("");

  container.querySelectorAll("[data-appt]").forEach((button) => {
    button.onclick = () => changeStatus(button.dataset.appt, button.dataset.status);
  });
}

async function changeStatus(id, status) {
  if (status === "CANCELLED") {
    const confirmed = await confirmDialog({ title: "Annuler ce rendez-vous ?", message: "Le créneau redeviendra libre et l'agent pourra le proposer à un autre client. Pensez à prévenir la personne concernée.", confirmLabel: "Annuler le rendez-vous", cancelLabel: "Garder le rendez-vous", tone: "danger" });
    if (!confirmed) return;
  }
  try {
    await api(`${base()}/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    showToast(status === "DONE" ? "Rendez-vous marqué comme terminé." : status === "NO_SHOW" ? "Client noté absent." : "Rendez-vous annulé.", "success");
    await loadAppointments();
  } catch (error) {
    showToast(error.message || "Mise à jour impossible.", "error");
  }
}

function openAddForm() {
  if (!$("#appt-date").value) $("#appt-date").value = localDay(Date.now());
  openDrawer($("#appointment-drawer"), { focus: "#appt-time" });
}

async function addManual(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#appt-save");
  button.disabled = true;
  button.classList.add("is-loading");
  try {
    await api(base(), {
      method: "POST",
      body: JSON.stringify({
        date: $("#appt-date").value,
        time: $("#appt-time").value,
        contactName: $("#appt-name").value.trim() || undefined,
        contactPhone: $("#appt-phone").value.trim() || undefined,
      }),
    });
    form.reset();
    await closeDrawer($("#appointment-drawer"), { force: true });
    setTab("agenda");
    await loadAppointments();
    showToast("Rendez-vous enregistré.", "success");
  } catch (error) {
    showToast(error.message || "Impossible d’enregistrer le rendez-vous.", "error");
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
  }
}

function setTab(tab) {
  $$("[data-appointments-tab]").forEach((button) => {
    const active = button.dataset.appointmentsTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$("[data-appointments-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.appointmentsPane !== tab));
}

export async function loadAppointments() {
  if (!getState().organizationId) return;
  try {
    const [settingsResult, listResult] = await Promise.all([
      api(`${base()}/settings`),
      api(`${base()}?from=${encodeURIComponent(new Date(Date.now() - 24 * 3600 * 1000).toISOString())}`),
    ]);
    settings = settingsResult.settings;
    appointments = listResult.appointments;
    // Des réglages en cours de modification ne sont pas remis à zéro par une simple mise à jour de la liste
    // (rendez-vous marqué « Terminé », rendez-vous ajouté…).
    if (!hasUnsavedAgendaChanges()) fillSettingsForm();
    renderAppointments();
  } catch (error) {
    $("#appointments-list").innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon("alert")}</span><p class="empty-title">Agenda indisponible</p><p class="empty-text">${escapeHtml(error.message || "Impossible de charger l’agenda.")}</p></div></div>`;
  }
}

export function initAppointments() {
  // Fin de session : il n'y a plus rien « à enregistrer » pour ce compte.
  document.addEventListener("brayano:session-ended", () => {
    cleanAgendaSnapshot = "";
    refreshDirty();
  });
  window.addEventListener("beforeunload", (event) => {
    if (hasUnsavedAgendaChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  $("#agenda-form").addEventListener("submit", saveSettings);
  ["input", "change"].forEach((type) => $("#agenda-form").addEventListener(type, refreshDirty));
  $("#agenda-discard").onclick = () => {
    if (settings) fillSettingsForm();
    showToast("Modifications annulées.", "info");
  };
  $("#appointment-add-form").addEventListener("submit", addManual);
  $("#add-appointment").onclick = openAddForm;
  $$("[data-appointments-tab]").forEach((button) => {
    button.onclick = () => setTab(button.dataset.appointmentsTab);
  });
  $("#agenda-closed-add").onclick = () => {
    const value = $("#agenda-closed-date").value;
    if (value && !closedDates.includes(value)) {
      closedDates = [...closedDates, value].sort();
      renderClosedDates();
      refreshDirty();
    }
    $("#agenda-closed-date").value = "";
  };
}
