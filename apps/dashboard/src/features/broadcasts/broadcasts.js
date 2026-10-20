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
/** Un envoi est en cours : le suivant doit attendre (un seul à la fois, pour protéger le numéro). */
let sending = false;

const base = () => `/organizations/${getState().organizationId}/broadcasts`;

function selectedStages() {
  return $$("#bc-stages input:checked").map((input) => input.value);
}

function audienceBody() {
  const stages = selectedStages();
  return { windowDays: Number($("#bc-window").value), ...(stages.length ? { stages } : {}), text: $("#bc-text").value };
}

const plural = (count, word) => `${count} ${word}${count > 1 ? "s" : ""}`;

function describePreview(preview) {
  const sample = preview.sample.length ? ` (ex. ${preview.sample.map(escapeHtml).join(", ")}${preview.recipients > preview.sample.length ? "…" : ""})` : "";
  if (!preview.ok) return `<span>${escapeHtml(preview.reason || "Envoi impossible pour le moment.")}</span>`;

  const lines = [`<strong>${plural(preview.recipients, "client")} recevr${preview.recipients > 1 ? "ont" : "a"} ce message maintenant</strong>${sample}`];
  if (preview.remaining > 0) {
    lines.push(`<span>Vous avez ${plural(preview.eligible, "client")} éligible${preview.eligible > 1 ? "s" : ""} : par sécurité, un envoi part par lots. Il en restera <b>${preview.remaining}</b>. Quand ce lot est terminé, cliquez de nouveau sur « Envoyer » avec <b>le même message</b> : il partira aux suivants, sans doublon.</span>`);
  } else if (preview.alreadyReceived > 0) {
    lines.push(`<span>${plural(preview.alreadyReceived, "autre")} client${preview.alreadyReceived > 1 ? "s l'ont" : " l'a"} déjà reçu : ${preview.alreadyReceived > 1 ? "ils sont exclus" : "il est exclu"}.</span>`);
  }
  lines.push(`<span>Il restera ${Math.max(0, preview.remainingToday - preview.recipients)} message(s) possible(s) aujourd'hui.</span>`);
  return lines.join("<br />");
}

async function refreshPreview() {
  const box = $("#bc-preview");
  const button = $("#bc-send");
  try {
    const { preview } = await api(`${base()}/preview`, { method: "POST", body: JSON.stringify(audienceBody()) });
    previewState = preview;
    $("#bc-max-per").textContent = preview.limits.maxRecipientsPerBroadcast;
    $("#bc-max-day").textContent = preview.limits.maxPerDay;
    box.className = `broadcast-preview${preview.ok ? "" : " blocked"}`;
    box.innerHTML = describePreview(preview) + (sending && preview.ok ? "<br /><span><b>Un envoi est en cours.</b> Attendez qu'il soit terminé pour envoyer le lot suivant.</span>" : "");
    button.disabled = !preview.ok || sending;
    button.textContent = preview.ok ? `Envoyer à ${plural(preview.recipients, "client")}` : "Envoyer";
  } catch (error) {
    previewState = null;
    box.className = "broadcast-preview blocked";
    box.textContent = error.message;
    button.disabled = true;
    button.textContent = "Envoyer";
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
    sending = broadcasts.some((item) => item.status === "SENDING");
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

export async function loadBroadcastsView() {
  await loadBroadcasts();
  await refreshPreview();
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
  if (!count) return showToast(previewState?.reason || "Aucun destinataire pour ces critères.", "error");
  const rest = previewState.remaining > 0 ? `\n\nIl restera ${previewState.remaining} client${previewState.remaining > 1 ? "s" : ""} : vous pourrez renvoyer le même message ensuite.` : "";
  if (!window.confirm(`Envoyer ce message à ${count} client${count > 1 ? "s" : ""} ?${rest}\n\nL'envoi se fait lentement (quelques secondes entre chaque message) et ne peut pas être rappelé.`)) return;
  const button = $("#bc-send");
  button.disabled = true;
  try {
    const stages = selectedStages();
    await api(base(), { method: "POST", body: JSON.stringify({ text, windowDays: Number($("#bc-window").value), ...(stages.length ? { stages } : {}) }) });
    // Le texte est gardé : pour un grand groupe, il suffit de renvoyer le même message pour le lot suivant.
    showToast(previewState?.remaining ? "Envoi lancé. Quand il est terminé, renvoyez le même message pour les clients restants." : "Envoi lancé. Suivez sa progression à droite.", "success");
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
    schedulePreview();
  });
}
