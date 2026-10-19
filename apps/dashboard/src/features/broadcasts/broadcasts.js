import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { formatDateTime } from "../../utils/format.js";
import { getState } from "../../state/store.js";

/**
 * Messages groupés : audience filtrée par étiquette, aperçu du nombre de destinataires et des limites avant l'envoi,
 * historique avec progression (rafraîchie tant qu'un envoi est en cours).
 */

const STATUS = {
  SENDING: ["En cours d'envoi", "warning"],
  DONE: ["Terminé", "success"],
  CANCELLED: ["Annulé", "neutral"],
};

let previewTimer = null;
let progressTimer = null;
let previewState = null;

const base = () => `/organizations/${getState().organizationId}/broadcasts`;

function selectedStages() {
  return $$("#bc-stages input:checked").map((input) => input.value);
}

function audienceQuery() {
  const params = new URLSearchParams({ days: $("#bc-window").value });
  const stages = selectedStages();
  if (stages.length) params.set("stages", stages.join(","));
  return params.toString();
}

async function refreshPreview() {
  const box = $("#bc-preview");
  try {
    const { preview } = await api(`${base()}/preview?${audienceQuery()}`);
    previewState = preview;
    $("#bc-max-per").textContent = preview.limits.maxRecipientsPerBroadcast;
    $("#bc-max-day").textContent = preview.limits.maxPerDay;
    const sample = preview.sample.length ? ` (ex. ${preview.sample.map(escapeHtml).join(", ")}${preview.recipients > preview.sample.length ? "…" : ""})` : "";
    const blocked = !preview.ok;
    box.className = `broadcast-preview${blocked ? " blocked" : ""}`;
    box.innerHTML = preview.recipients === 0
      ? "Aucun client éligible avec ces critères. Élargissez la période ou changez les étiquettes."
      : blocked
        ? `<strong>${preview.recipients} destinataire${preview.recipients > 1 ? "s" : ""}</strong>${sample}<br /><span>${escapeHtml(preview.reason || "Envoi impossible pour le moment.")}</span>`
        : `<strong>${preview.recipients} destinataire${preview.recipients > 1 ? "s" : ""}</strong>${sample}<br /><span>Il restera ${preview.remainingToday - preview.recipients} message(s) possible(s) aujourd'hui.</span>`;
    $("#bc-send").disabled = blocked || preview.recipients === 0;
  } catch (error) {
    previewState = null;
    box.className = "broadcast-preview blocked";
    box.textContent = error.message;
    $("#bc-send").disabled = true;
  }
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshPreview(), 250);
}

function itemMarkup(item) {
  const [label, tone] = STATUS[item.status] || [item.status, "neutral"];
  const done = item.sentCount + item.failedCount;
  const percent = item.total ? Math.round((done / item.total) * 100) : 100;
  return `
    <article class="bc-item">
      <header>
        <span class="status-chip ${tone}">${escapeHtml(label)}</span>
        <small class="muted">${escapeHtml(formatDateTime(item.createdAt))}</small>
      </header>
      <p class="bc-text">${escapeHtml(item.text)}</p>
      <div class="bc-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
      <footer>
        <small>${item.sentCount} envoyé${item.sentCount > 1 ? "s" : ""} sur ${item.total}${item.failedCount ? ` · ${item.failedCount} échec${item.failedCount > 1 ? "s" : ""}` : ""}</small>
        ${item.status === "SENDING" ? `<button type="button" class="text-button danger-text" data-cancel="${escapeHtml(item.id)}">Arrêter l'envoi</button>` : ""}
      </footer>
    </article>`;
}

export async function loadBroadcasts() {
  if (!getState().organizationId) return;
  try {
    const { broadcasts } = await api(base());
    $("#bc-list").innerHTML = broadcasts.length ? broadcasts.map(itemMarkup).join("") : '<div class="empty-state">Aucun envoi pour le moment.</div>';
    $$("[data-cancel]", $("#bc-list")).forEach((button) => {
      button.onclick = () => cancel(button.dataset.cancel);
    });
    clearTimeout(progressTimer);
    if (broadcasts.some((item) => item.status === "SENDING") && !$("#broadcasts-view").classList.contains("hidden")) {
      progressTimer = setTimeout(() => void loadBroadcasts().then(refreshPreview), 6000);
    }
  } catch (error) {
    $("#bc-list").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

export function loadBroadcastsView() {
  void refreshPreview();
  return loadBroadcasts();
}

async function cancel(id) {
  if (!window.confirm("Arrêter cet envoi ? Les messages déjà partis ne peuvent pas être rappelés.")) return;
  try {
    await api(`${base()}/${id}/cancel`, { method: "POST" });
    showToast("Envoi arrêté.", "success");
    await loadBroadcasts();
    await refreshPreview();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function send(event) {
  event.preventDefault();
  const text = $("#bc-text").value.trim();
  if (!text) return showToast("Écrivez le message à envoyer.", "error");
  const count = previewState?.recipients ?? 0;
  if (!count) return showToast("Aucun destinataire pour ces critères.", "error");
  if (!window.confirm(`Envoyer ce message à ${count} client${count > 1 ? "s" : ""} ?\n\nL'envoi se fait lentement (quelques secondes entre chaque message) et ne peut pas être rappelé.`)) return;
  const button = $("#bc-send");
  button.disabled = true;
  try {
    const stages = selectedStages();
    await api(base(), { method: "POST", body: JSON.stringify({ text, windowDays: Number($("#bc-window").value), ...(stages.length ? { stages } : {}) }) });
    $("#bc-text").value = "";
    $("#bc-counter").textContent = "0 / 1000 caractères";
    showToast("Envoi lancé. Suivez sa progression à droite.", "success");
    await loadBroadcasts();
    await refreshPreview();
  } catch (error) {
    showToast(error.message, "error");
    await refreshPreview();
  }
}

export function initBroadcasts() {
  $("#broadcast-form").onsubmit = send;
  $("#bc-stages").addEventListener("change", schedulePreview);
  $("#bc-window").addEventListener("change", schedulePreview);
  $("#bc-text").addEventListener("input", (event) => {
    $("#bc-counter").textContent = `${event.target.value.length} / ${event.target.maxLength} caractères`;
  });
}
