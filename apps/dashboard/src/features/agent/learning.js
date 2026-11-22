import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { confirmDialog } from "../../ui/confirm.js";
import { icon } from "../../ui/icons.js";

/**
 * Onglet « Apprentissage » : les corrections du propriétaire. L'assistant les applique aux questions semblables.
 * Tout est visible, modifiable, désactivable et supprimable ici.
 */

let corrections = [];
let editingId = null;

const base = () => `/organizations/${getState().organizationId}/ai-corrections`;

function itemMarkup(item) {
  const editing = editingId === item.id;
  const when = item.question ? `Quand le client demande <strong>« ${escapeHtml(item.question)} »</strong>` : "<strong>Règle générale</strong>, valable pour toutes les questions";
  const used = item.usedCount ? `Appliquée ${item.usedCount} fois` : "Pas encore appliquée";
  return `
    <article class="card learning-item${item.active ? "" : " is-paused"}" data-id="${escapeHtml(item.id)}">
      <div class="learning-body">
        <p class="learning-when">${when}</p>
        ${editing
          ? `<textarea class="learning-edit" rows="3" maxlength="1000" aria-label="Réponse à donner">${escapeHtml(item.correctReply)}</textarea>`
          : `<p class="learning-answer">${icon("reply", "icon-sm")}<span>${escapeHtml(item.correctReply)}</span></p>`}
        ${item.wrongReply && !editing ? `<p class="learning-wrong">Ancienne réponse jugée mauvaise : « ${escapeHtml(item.wrongReply.slice(0, 160))}${item.wrongReply.length > 160 ? "…" : ""} »</p>` : ""}
      </div>
      <footer class="learning-foot">
        <span class="learning-meta">${item.active ? "" : '<span class="badge neutral">En pause</span>'}<small>${escapeHtml(used)}</small></span>
        <div class="learning-actions">
          ${editing
            ? `<button type="button" class="btn btn-sm btn-ghost" data-act="cancel">Annuler</button><button type="button" class="btn btn-sm btn-primary" data-act="save">Enregistrer</button>`
            : `<button type="button" class="btn btn-sm btn-ghost" data-act="toggle">${icon(item.active ? "pause" : "play")}${item.active ? "Mettre en pause" : "Réactiver"}</button>
               <button type="button" class="btn btn-sm btn-ghost" data-act="edit">${icon("edit")}Modifier</button>
               <button type="button" class="btn btn-sm btn-ghost btn-danger-ghost" data-act="delete">${icon("trash")}Supprimer</button>`}
        </div>
      </footer>
    </article>`;
}

function render() {
  const list = $("#learning-list");
  if (!list) return;
  list.innerHTML = corrections.length
    ? corrections.map(itemMarkup).join("")
    : `<div class="card"><div class="empty"><span class="empty-icon">${icon("graduation")}</span><p class="empty-title">Aucune correction pour le moment</p><p class="empty-text">Dès que vous corrigerez une réponse dans une conversation, ou que vous ajouterez une règle ci-dessus, elle apparaîtra ici.</p></div></div>`;
}

export async function loadLearning() {
  if (!getState().organizationId) return;
  try {
    ({ corrections } = await api(base()));
    render();
  } catch (error) {
    $("#learning-list").innerHTML = `<div class="card"><div class="empty"><p class="empty-text">${escapeHtml(error.message || "Impossible de charger les corrections.")}</p></div></div>`;
  }
}

async function addRule() {
  const answer = $("#learn-answer").value.trim();
  if (!answer) return showToast("Écrivez la réponse que l'agent doit donner.", "error");
  const button = $("#learn-add");
  button.disabled = true;
  try {
    await api(base(), { method: "POST", body: JSON.stringify({ question: $("#learn-question").value.trim() || undefined, correctReply: answer }) });
    $("#learn-question").value = "";
    $("#learn-answer").value = "";
    showToast("Règle ajoutée. L'agent l'appliquera dès la prochaine question semblable.", "success");
    await loadLearning();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function act(item, action, article) {
  try {
    if (action === "edit") {
      editingId = item.id;
      return render();
    }
    if (action === "cancel") {
      editingId = null;
      return render();
    }
    if (action === "save") {
      const correctReply = article.querySelector(".learning-edit").value.trim();
      if (!correctReply) return showToast("La réponse ne peut pas être vide.", "error");
      await api(`${base()}/${item.id}`, { method: "PUT", body: JSON.stringify({ correctReply }) });
      editingId = null;
      showToast("Règle modifiée.", "success");
    }
    if (action === "toggle") {
      await api(`${base()}/${item.id}`, { method: "PUT", body: JSON.stringify({ active: !item.active }) });
    }
    if (action === "delete") {
      if (!(await confirmDialog({ title: "Supprimer cette règle ?", message: "L'agent ne l'appliquera plus. Cette action est définitive.", confirmLabel: "Supprimer", tone: "danger", iconName: "trash" }))) return;
      await api(`${base()}/${item.id}`, { method: "DELETE" });
      showToast("Règle supprimée.", "success");
    }
    await loadLearning();
  } catch (error) {
    showToast(error.message, "error");
  }
}

export function initLearning() {
  $("#learn-add").onclick = addRule;
  $("#learning-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const article = button.closest(".learning-item");
    const item = corrections.find((entry) => entry.id === article.dataset.id);
    if (item) void act(item, button.dataset.act, article);
  });
}
