import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";

/**
 * Onglet « Apprentissage » : les corrections du propriétaire. L'assistant les applique aux questions semblables.
 * Tout est visible, modifiable, désactivable et supprimable ici.
 */

let corrections = [];
let editingId = null;

const base = () => `/organizations/${getState().organizationId}/ai-corrections`;

function itemMarkup(item) {
  const editing = editingId === item.id;
  const when = item.question ? `Quand le client demande : <strong>« ${escapeHtml(item.question)} »</strong>` : "<strong>Règle générale</strong> (valable pour toutes les questions)";
  const used = item.usedCount ? `Appliquée ${item.usedCount} fois` : "Pas encore appliquée";
  return `
    <article class="learning-item${item.active ? "" : " is-off"}" data-id="${escapeHtml(item.id)}">
      <p class="learning-when">${when}</p>
      ${editing
        ? `<textarea class="learning-edit" rows="3" maxlength="1000" aria-label="Réponse à donner">${escapeHtml(item.correctReply)}</textarea>`
        : `<p class="learning-answer">${escapeHtml(item.correctReply)}</p>`}
      ${item.wrongReply && !editing ? `<p class="muted learning-wrong">Ancienne réponse jugée mauvaise : « ${escapeHtml(item.wrongReply.slice(0, 160))}${item.wrongReply.length > 160 ? "…" : ""} »</p>` : ""}
      <footer>
        <small class="muted">${escapeHtml(used)}</small>
        <div class="learning-actions">
          ${editing
            ? `<button type="button" class="text-button" data-act="save">Enregistrer</button><button type="button" class="text-button" data-act="cancel">Annuler</button>`
            : `<button type="button" class="text-button" data-act="toggle">${item.active ? "Mettre en pause" : "Réactiver"}</button>
               <button type="button" class="text-button" data-act="edit">Modifier</button>
               <button type="button" class="text-button danger-text" data-act="delete">Supprimer</button>`}
        </div>
      </footer>
    </article>`;
}

function render() {
  const list = $("#learning-list");
  if (!list) return;
  list.innerHTML = corrections.length
    ? corrections.map(itemMarkup).join("")
    : '<div class="empty-state">Rien pour le moment. Dès que vous corrigerez une réponse dans une conversation, elle apparaîtra ici.</div>';
}

export async function loadLearning() {
  if (!getState().organizationId) return;
  try {
    ({ corrections } = await api(base()));
    render();
  } catch (error) {
    $("#learning-list").innerHTML = `<div class="empty-state">${escapeHtml(error.message || "Impossible de charger les corrections.")}</div>`;
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
      if (!window.confirm("Supprimer cette règle ? L'agent ne l'appliquera plus.")) return;
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
