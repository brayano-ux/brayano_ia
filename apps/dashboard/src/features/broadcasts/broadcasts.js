import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { formatDateTime } from "../../utils/format.js";
import { getState } from "../../state/store.js";
import { confirmDialog } from "../../ui/confirm.js";
import { icon } from "../../ui/icons.js";

/**
 * Messages groupés : audience filtrée par étiquette, aperçu du nombre de destinataires et des limites avant l'envoi,
 * historique avec progression (rafraîchie tant qu'un envoi est en cours).
 */

const STATUS = {
  SENDING: ["En cours d'envoi", "info"],
  DONE: ["Terminé", "success"],
  CANCELLED: ["Arrêté", "neutral"],
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
    box.className = `broadcast-preview alert ${preview.ok ? "success" : "warning"}`;
    box.innerHTML = `${icon(preview.ok ? "users" : "alert")}<div class="alert-body">${describePreview(preview)}${sending && preview.ok ? "<br /><span><b>Un envoi est en cours.</b> Attendez qu'il soit terminé pour envoyer le lot suivant.</span>" : ""}</div>`;
    button.disabled = !preview.ok || sending;
    button.textContent = preview.ok ? `Envoyer à ${plural(preview.recipients, "client")}` : "Envoyer";
  } catch (error) {
    previewState = null;
    box.className = "broadcast-preview alert warning";
    box.innerHTML = `${icon("alert")}<div class="alert-body"></div>`;
    box.querySelector(".alert-body").textContent = error.message;
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
    <article class="card bc-item">
      <header class="bc-item-head">
        <span class="badge ${tone}">${item.status === "SENDING" ? "<i></i>" : ""}${escapeHtml(label)}</span>
        <small>${escapeHtml(formatDateTime(item.createdAt))}</small>
        ${item.status === "SENDING" ? `<button type="button" class="btn btn-sm btn-ghost btn-danger-ghost" data-cancel="${escapeHtml(item.id)}">${icon("close")}Arrêter l'envoi</button>` : ""}
      </header>
      <p class="bc-text">${escapeHtml(item.text)}</p>
      <footer class="bc-item-foot">
        <div class="progress ${item.status === "DONE" ? "success" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
        <small class="num">${item.sentCount} envoyé${item.sentCount > 1 ? "s" : ""} sur ${item.total}${item.failedCount ? ` · ${item.failedCount} échec${item.failedCount > 1 ? "s" : ""}` : ""}</small>
      </footer>
    </article>`;
}

export async function loadBroadcasts() {
  if (!getState().organizationId) return;
  try {
    const { broadcasts } = await api(base());
    sending = broadcasts.some((item) => item.status === "SENDING");
    $("#bc-list").innerHTML = broadcasts.length
      ? broadcasts.map(itemMarkup).join("")
      : `<div class="card"><div class="empty empty-compact"><span class="empty-icon">${icon("megaphone")}</span><p class="empty-title">Aucun envoi pour le moment</p><p class="empty-text">Vos annonces envoyées apparaîtront ici, avec leur progression.</p></div></div>`;
    $$("[data-cancel]", $("#bc-list")).forEach((button) => {
      button.onclick = () => cancel(button.dataset.cancel);
    });
    clearTimeout(progressTimer);
    if (broadcasts.some((item) => item.status === "SENDING") && !$("#broadcasts-view").classList.contains("hidden")) {
      progressTimer = setTimeout(() => void loadBroadcasts().then(refreshPreview), 6000);
    }
  } catch (error) {
    $("#bc-list").innerHTML = `<div class="card"><div class="empty empty-compact"><p class="empty-text">${escapeHtml(error.message)}</p></div></div>`;
  }
}

export async function loadBroadcastsView() {
  const name = getState().organizationName || "Votre entreprise";
  $("#bc-preview-name").textContent = name;
  $("#bc-preview-avatar").textContent = name.trim().charAt(0).toUpperCase() || "B";
  await loadBroadcasts();
  await refreshPreview();
}

async function cancel(id) {
  if (!(await confirmDialog({ title: "Arrêter cet envoi ?", message: "Les messages déjà partis ne peuvent pas être rappelés. Les clients restants ne recevront rien.", confirmLabel: "Arrêter l'envoi", cancelLabel: "Laisser continuer", tone: "danger" }))) return;
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
  const rest = previewState.remaining > 0 ? `Il restera ${previewState.remaining} client${previewState.remaining > 1 ? "s" : ""} : vous pourrez renvoyer le même message ensuite.\n\n` : "";
  const confirmed = await confirmDialog({
    title: `Envoyer à ${count} client${count > 1 ? "s" : ""} ?`,
    message: `${rest}L'envoi se fait lentement (quelques secondes entre chaque message) et ne peut pas être rappelé.`,
    confirmLabel: "Envoyer maintenant",
    iconName: "megaphone",
  });
  if (!confirmed) return;
  const button = $("#bc-send");
  button.disabled = true;
  try {
    const stages = selectedStages();
    await api(base(), { method: "POST", body: JSON.stringify({ text, windowDays: Number($("#bc-window").value), ...(stages.length ? { stages } : {}) }) });
    // Le texte est gardé : pour un grand groupe, il suffit de renvoyer le même message pour le lot suivant.
    showToast(previewState?.remaining ? "Envoi lancé. Quand il est terminé, renvoyez le même message pour les clients restants." : "Envoi lancé. Suivez sa progression dans « Derniers envois ».", "success");
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
    // Aperçu en direct, tel que le client le verra dans WhatsApp.
    const bubble = $("#bc-preview-text");
    const text = event.target.value.trim();
    bubble.textContent = text || "Votre message apparaîtra ici.";
    bubble.classList.toggle("is-placeholder", !text);
    schedulePreview();
  });
}
