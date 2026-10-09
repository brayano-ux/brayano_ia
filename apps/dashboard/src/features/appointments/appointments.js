import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";

const DAYS = [
  ["mon", "Lundi"],
  ["tue", "Mardi"],
  ["wed", "Mercredi"],
  ["thu", "Jeudi"],
  ["fri", "Vendredi"],
  ["sat", "Samedi"],
  ["sun", "Dimanche"],
];

const STATUS_LABELS = { BOOKED: "Confirmé", CANCELLED: "Annulé", DONE: "Terminé", NO_SHOW: "Absent" };

let settings = null;
let closedDates = [];
let appointments = [];

const base = () => `/organizations/${getState().organizationId}/appointments`;

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

function renderClosedDates() {
  const container = $("#agenda-closed-list");
  container.innerHTML = closedDates.length
    ? closedDates.map((date) => `<span class="agenda-chip">${escapeHtml(date)} <button type="button" data-remove-closed="${escapeHtml(date)}" aria-label="Retirer ${escapeHtml(date)}">×</button></span>`).join("")
    : '<span class="muted">Aucun jour fermé.</span>';
  container.querySelectorAll("[data-remove-closed]").forEach((button) => {
    button.onclick = () => {
      closedDates = closedDates.filter((date) => date !== button.dataset.removeClosed);
      renderClosedDates();
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
  }
}

function formatWhen(startsAt) {
  const tz = settings?.timezone || "Africa/Douala";
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(startsAt));
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(startsAt));
  return { date, time };
}

function renderAppointments() {
  const container = $("#appointments-list");
  const active = appointments.filter((appointment) => appointment.status === "BOOKED");
  $("#appointments-count").textContent = `${active.length} à venir`;

  if (!appointments.length) {
    container.innerHTML = '<div class="empty-state">Aucun rendez-vous pour le moment.</div>';
    return;
  }

  const groups = new Map();
  for (const appointment of appointments) {
    const { date } = formatWhen(appointment.startsAt);
    groups.set(date, [...(groups.get(date) || []), appointment]);
  }

  container.innerHTML = [...groups.entries()].map(([date, items]) => `
    <div class="appointment-day">
      <h3>${escapeHtml(date)}</h3>
      ${items.map((appointment) => `
        <article class="appointment-card status-${appointment.status.toLowerCase()}">
          <strong class="appointment-time">${escapeHtml(formatWhen(appointment.startsAt).time)}</strong>
          <div class="appointment-info">
            <span>${escapeHtml(appointment.contactName || appointment.contactPhone || "Client WhatsApp")}</span>
            <small class="muted">${escapeHtml([appointment.service, appointment.contactPhone && appointment.contactName ? appointment.contactPhone : "", appointment.source === "AI" ? "pris par l’agent" : "ajouté à la main"].filter(Boolean).join(" • "))}</small>
          </div>
          <span class="appointment-status">${STATUS_LABELS[appointment.status] || appointment.status}</span>
          ${appointment.status === "BOOKED" ? `
            <div class="appointment-actions">
              <button type="button" class="text-button" data-appt="${escapeHtml(appointment.id)}" data-status="DONE">Terminé</button>
              <button type="button" class="text-button" data-appt="${escapeHtml(appointment.id)}" data-status="NO_SHOW">Absent</button>
              <button type="button" class="text-button danger-text" data-appt="${escapeHtml(appointment.id)}" data-status="CANCELLED">Annuler</button>
            </div>` : ""}
        </article>`).join("")}
    </div>`).join("");

  container.querySelectorAll("[data-appt]").forEach((button) => {
    button.onclick = () => changeStatus(button.dataset.appt, button.dataset.status);
  });
}

async function changeStatus(id, status) {
  if (status === "CANCELLED" && !window.confirm("Annuler ce rendez-vous ? Le créneau redeviendra libre.")) return;
  try {
    await api(`${base()}/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    await loadAppointments();
  } catch (error) {
    showToast(error.message || "Mise à jour impossible.", "error");
  }
}

async function addManual(event) {
  event.preventDefault();
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
    event.currentTarget.reset();
    await loadAppointments();
    showToast("Rendez-vous enregistré.", "success");
  } catch (error) {
    showToast(error.message || "Impossible d’enregistrer le rendez-vous.", "error");
  }
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
    fillSettingsForm();
    renderAppointments();
  } catch (error) {
    showToast(error.message || "Impossible de charger l’agenda.", "error");
  }
}

export function initAppointments() {
  $("#agenda-form").addEventListener("submit", saveSettings);
  $("#appointment-add-form").addEventListener("submit", addManual);
  $("#agenda-closed-add").onclick = () => {
    const value = $("#agenda-closed-date").value;
    if (value && !closedDates.includes(value)) {
      closedDates = [...closedDates, value].sort();
      renderClosedDates();
    }
    $("#agenda-closed-date").value = "";
  };
}
