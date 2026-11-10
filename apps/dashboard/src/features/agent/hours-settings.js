import { $, $$, escapeHtml } from "../../utils/dom.js";

/**
 * Onglet « Horaires et relances » de l'Agent IA : horaires d'ouverture (l'agent prévient le client quand
 * l'entreprise est fermée) et relances automatiques des clients intéressés qui ne répondent plus.
 * Les valeurs sont enregistrées avec le reste du formulaire de l'agent.
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

const DEFAULT_HOURS = Object.fromEntries(DAYS.map(([key]) => [key, key === "sun" ? [] : [{ start: "08:00", end: "18:00" }]]));

function renderRows(hours) {
  $("#bh-rows").innerHTML = DAYS.map(([key, label]) => {
    const [first = {}, second = {}] = hours?.[key] || [];
    return `
      <div class="bh-row" data-day="${key}" data-label="${label}">
        <span class="agenda-day">${label}</span>
        <div class="agenda-range">
          <input type="time" data-field="s1" value="${escapeHtml(first.start || "")}" aria-label="${label} — ouverture" />
          <span>→</span>
          <input type="time" data-field="e1" value="${escapeHtml(first.end || "")}" aria-label="${label} — fermeture" />
        </div>
        <div class="agenda-range">
          <input type="time" data-field="s2" value="${escapeHtml(second.start || "")}" aria-label="${label} — réouverture" />
          <span>→</span>
          <input type="time" data-field="e2" value="${escapeHtml(second.end || "")}" aria-label="${label} — refermeture" />
        </div>
      </div>`;
  }).join("");
}

function readHours() {
  const hours = {};
  $$(".bh-row").forEach((row) => {
    const value = (field) => row.querySelector(`[data-field="${field}"]`).value;
    const ranges = [];
    if (value("s1") && value("e1")) ranges.push({ start: value("s1"), end: value("e1") });
    if (value("s2") && value("e2")) ranges.push({ start: value("s2"), end: value("e2") });
    hours[row.dataset.day] = ranges;
  });
  return hours;
}

function syncVisibility() {
  $("#bh-details").classList.toggle("is-off", !$("#bh-enabled").checked);
  $("#fu-details").classList.toggle("is-off", !$("#fu-enabled").checked);
  $("#tg-details").classList.toggle("is-off", !$("#tg-enabled").checked);
  $("#neg-details").classList.toggle("is-off", !$("#neg-enabled").checked);
  const amountMode = $("#neg-mode-amount").checked;
  $("#neg-percent-field").classList.toggle("hidden", amountMode);
  $("#neg-amount-field").classList.toggle("hidden", !amountMode);
}

function ensureOption(select, value) {
  if (![...select.options].some((option) => option.value === String(value))) {
    select.add(new Option(`${value} heures`, String(value)));
  }
  select.value = String(value);
}

export function fillHoursSettings(settings) {
  $("#bh-enabled").checked = Boolean(settings.businessHoursEnabled);
  const stored = settings.businessHours && typeof settings.businessHours === "object" ? settings.businessHours : {};
  const hasHours = Object.values(stored).some((ranges) => Array.isArray(ranges) && ranges.length);
  renderRows(hasHours ? stored : DEFAULT_HOURS);
  $("#bh-timezone").value = settings.businessTimezone || "Africa/Douala";
  $("#bh-closed-message").value = settings.closedMessage || "";
  $("#fu-enabled").checked = Boolean(settings.followUpEnabled);
  ensureOption($("#fu-delay"), settings.followUpDelayHours || 24);
  $("#fu-max").value = String(settings.followUpMax || 1);
  $("#tg-enabled").checked = Boolean(settings.topicGateEnabled);
  $("#tg-topic").value = settings.topicGateTopic || "";
  $("#ad-only-enabled").checked = Boolean(settings.adOnlyEnabled);
  $("#neg-enabled").checked = Boolean(settings.negotiationEnabled);
  $("#neg-max-discount").value = String(settings.negotiationMaxDiscountPercent || 10);
  $("#neg-max-amount").value = settings.negotiationMaxDiscountAmount ? String(settings.negotiationMaxDiscountAmount) : "";
  const amountMode = settings.negotiationDiscountMode === "amount";
  $("#neg-mode-amount").checked = amountMode;
  $("#neg-mode-percent").checked = !amountMode;
  syncVisibility();
}

export function readHoursSettings() {
  return {
    businessHoursEnabled: $("#bh-enabled").checked,
    businessHours: readHours(),
    businessTimezone: $("#bh-timezone").value.trim() || "Africa/Douala",
    closedMessage: $("#bh-closed-message").value.trim() || null,
    followUpEnabled: $("#fu-enabled").checked,
    followUpDelayHours: Number($("#fu-delay").value),
    followUpMax: Number($("#fu-max").value),
    topicGateEnabled: $("#tg-enabled").checked,
    topicGateTopic: $("#tg-topic").value.trim() || null,
    adOnlyEnabled: $("#ad-only-enabled").checked,
    negotiationEnabled: $("#neg-enabled").checked,
    negotiationDiscountMode: $("#neg-mode-amount").checked ? "amount" : "percent",
    // Un champ vide ou hors limites ne doit pas effacer la valeur de l'autre mode : on garde alors une valeur sûre.
    negotiationMaxDiscountPercent: readWholeNumber("#neg-max-discount", 1, 50) ?? 10,
    negotiationMaxDiscountAmount: readWholeNumber("#neg-max-amount", 100, 10_000_000),
  };
}

/** Nombre entier saisi dans un champ, ou null s'il est vide, non entier ou hors des bornes. */
function readWholeNumber(selector, min, max) {
  const raw = $(selector).value.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function hoursSnapshot() {
  return JSON.stringify(readHoursSettings());
}

/** Remise maximale de la négociation : renvoie { message, selector } pour le champ à corriger, ou null si tout est correct. */
export function validateNegotiation() {
  if (!$("#neg-enabled").checked) return null;
  if ($("#neg-mode-amount").checked) {
    return readWholeNumber("#neg-max-amount", 100, 10_000_000) === null
      ? { selector: "#neg-max-amount", message: "Négociation : indiquez le montant maximal de la remise, en FCFA (100 au minimum, sans virgule)." }
      : null;
  }
  return readWholeNumber("#neg-max-discount", 1, 50) === null
    ? { selector: "#neg-max-discount", message: "Négociation : indiquez un pourcentage de remise entre 1 et 50." }
    : null;
}

/** Renvoie un message d'erreur lisible, ou "" si tout est correct. */
export function validateHours() {
  if ($("#tg-enabled").checked && !$("#tg-topic").value.trim()) {
    return "Indiquez le sujet autorisé, ou désactivez cette limite.";
  }
  if (!$("#bh-enabled").checked) return "";
  let openDays = 0;
  for (const row of $$(".bh-row")) {
    const value = (field) => row.querySelector(`[data-field="${field}"]`).value;
    const label = row.dataset.label;
    for (const [start, end] of [["s1", "e1"], ["s2", "e2"]]) {
      if (Boolean(value(start)) !== Boolean(value(end))) return `${label} : indiquez l'heure d'ouverture ET de fermeture.`;
      if (value(start) && value(start) >= value(end)) return `${label} : la fermeture doit être après l'ouverture.`;
    }
    if (value("s1") && value("s2") && value("e1") > value("s2")) return `${label} : la deuxième plage doit commencer après la première.`;
    if (value("s1")) openDays += 1;
  }
  if (!openDays) return "Indiquez au moins un jour d'ouverture, ou décochez les horaires.";
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: $("#bh-timezone").value.trim() || "Africa/Douala" });
  } catch {
    return "Fuseau horaire inconnu (exemple : Africa/Douala).";
  }
  return "";
}

export function initHoursSettings() {
  renderRows(DEFAULT_HOURS);
  $("#bh-enabled").addEventListener("change", syncVisibility);
  $("#fu-enabled").addEventListener("change", syncVisibility);
  $("#neg-enabled").addEventListener("change", syncVisibility);
  $("#neg-mode-percent").addEventListener("change", syncVisibility);
  $("#neg-mode-amount").addEventListener("change", syncVisibility);
}
