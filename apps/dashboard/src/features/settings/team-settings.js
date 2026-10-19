import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { formatDateTime } from "../../utils/format.js";
import { getState } from "../../state/store.js";

/** Équipe : le propriétaire ajoute, met en pause ou retire des employés qui partagent la boîte de réception. */

let members = [];
let maxMembers = 10;

const base = () => `/organizations/${getState().organizationId}/team`;

function memberMarkup(member) {
  const owner = member.role === "ADMIN";
  return `
    <article class="team-member${member.active ? "" : " is-off"}" data-id="${escapeHtml(member.id)}">
      <div>
        <strong>${escapeHtml(member.name || member.email)}</strong>
        <small class="muted">${escapeHtml(member.email)} · ajouté le ${escapeHtml(formatDateTime(member.createdAt))}</small>
      </div>
      <span class="status-chip ${owner ? "success" : member.active ? "neutral" : "warning"}">${owner ? "Propriétaire" : member.active ? "Employé" : "Accès suspendu"}</span>
      ${owner ? "" : `<div class="team-actions">
        <button type="button" class="text-button" data-act="toggle">${member.active ? "Suspendre l'accès" : "Réactiver"}</button>
        <button type="button" class="text-button" data-act="password">Nouveau mot de passe</button>
        <button type="button" class="text-button danger-text" data-act="remove">Retirer</button>
      </div>`}
    </article>`;
}

function render() {
  $("#team-list").innerHTML = members.map(memberMarkup).join("") || '<div class="empty-state">Aucun membre.</div>';
}

export async function loadTeam() {
  if (!getState().organizationId) return;
  try {
    ({ members, maxMembers } = await api(base()));
    render();
  } catch (error) {
    $("#team-list").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function act(member, action) {
  try {
    if (action === "toggle") {
      await api(`${base()}/${member.id}`, { method: "PUT", body: JSON.stringify({ active: !member.active }) });
      showToast(member.active ? "Accès suspendu." : "Accès rétabli.", "success");
    }
    if (action === "password") {
      const password = window.prompt(`Nouveau mot de passe pour ${member.name || member.email} (8 caractères minimum) :`);
      if (!password) return;
      await api(`${base()}/${member.id}`, { method: "PUT", body: JSON.stringify({ password }) });
      showToast("Mot de passe modifié. Communiquez-le à l'employé.", "success");
    }
    if (action === "remove") {
      if (!window.confirm(`Retirer ${member.name || member.email} ? Il ne pourra plus se connecter. Ses réponses passées restent dans les conversations.`)) return;
      await api(`${base()}/${member.id}`, { method: "DELETE" });
      showToast("Employé retiré.", "success");
    }
    await loadTeam();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function addMember(event) {
  event.preventDefault();
  if (members.length >= maxMembers) return showToast(`Votre équipe est limitée à ${maxMembers} personnes.`, "error");
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(base(), { method: "POST", body: JSON.stringify({ name: $("#team-name").value, email: $("#team-email").value, password: $("#team-password").value }) });
    event.target.reset();
    showToast("Employé ajouté.", "success");
    await loadTeam();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

export function initTeamSettings() {
  $("#team-form").onsubmit = addMember;
  $("#team-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const member = members.find((entry) => entry.id === button.closest(".team-member").dataset.id);
    if (member) void act(member, button.dataset.act);
  });
}
