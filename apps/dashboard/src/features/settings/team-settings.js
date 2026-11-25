import { api } from "../../services/api.js";
import { askFields } from "../../utils/ask.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { avatarMarkup } from "../../ui/avatar.js";
import { confirmDialog } from "../../ui/confirm.js";
import { icon } from "../../ui/icons.js";

/** Équipe : le propriétaire ajoute, met en pause ou retire des employés qui partagent la boîte de réception. */

let members = [];
let maxMembers = 11; // le propriétaire et 10 employés ; la vraie valeur vient du serveur

const base = () => `/organizations/${getState().organizationId}/team`;

function memberMarkup(member) {
  const owner = member.role === "ADMIN";
  const name = member.name || member.email;
  const added = new Date(member.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `
    <article class="list-row team-member${member.active ? "" : " is-suspended"}" data-id="${escapeHtml(member.id)}">
      ${avatarMarkup(name, { seed: member.email })}
      <div class="list-main">
        <span class="list-title truncate">${escapeHtml(name)}</span>
        <span class="list-sub truncate">${escapeHtml(member.email)} · ajouté le ${escapeHtml(added)}</span>
      </div>
      <span class="badge ${owner ? "info" : member.active ? "neutral" : "warning"}">${owner ? "Propriétaire" : member.active ? "Employé" : "Accès suspendu"}</span>
      ${owner ? '<span class="team-actions-placeholder"></span>' : `<div class="menu-anchor">
        <button type="button" class="btn-icon btn-sm btn-ghost" data-menu="team-menu-${escapeHtml(member.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour ${escapeHtml(name)}">${icon("more-vertical", "icon-sm")}</button>
        <div class="menu" id="team-menu-${escapeHtml(member.id)}" role="menu">
          <button type="button" class="menu-item" role="menuitem" data-act="toggle">${icon(member.active ? "pause" : "play")}${member.active ? "Suspendre l'accès" : "Réactiver l'accès"}</button>
          <button type="button" class="menu-item" role="menuitem" data-act="password">${icon("key")}Nouveau mot de passe</button>
          <div class="menu-sep"></div>
          <button type="button" class="menu-item danger" role="menuitem" data-act="remove">${icon("trash")}Retirer de l'équipe</button>
        </div>
      </div>`}
    </article>`;
}

function render() {
  $("#team-list").innerHTML = members.map(memberMarkup).join("") || '<div class="empty empty-compact"><p class="empty-text">Aucun membre pour le moment.</p></div>';
}

export async function loadTeam() {
  if (!getState().organizationId) return;
  try {
    ({ members, maxMembers } = await api(base()));
    render();
  } catch (error) {
    $("#team-list").innerHTML = `<div class="empty empty-compact"><p class="empty-text">${escapeHtml(error.message)}</p></div>`;
  }
}

async function act(member, action) {
  try {
    if (action === "toggle") {
      await api(`${base()}/${member.id}`, { method: "PUT", body: JSON.stringify({ active: !member.active }) });
      showToast(member.active ? "Accès suspendu." : "Accès rétabli.", "success");
    }
    if (action === "password") {
      const answer = await askFields({
        title: `Nouveau mot de passe pour ${member.name || member.email}`,
        intro: "8 caractères minimum. Communiquez-le ensuite à l'employé.",
        confirmLabel: "Changer le mot de passe",
        fields: [{ name: "password", label: "Nouveau mot de passe", type: "password", minLength: 8, autocomplete: "new-password" }],
      });
      if (!answer) return;
      const { password } = answer;
      await api(`${base()}/${member.id}`, { method: "PUT", body: JSON.stringify({ password }) });
      showToast("Mot de passe modifié. Communiquez-le à l'employé.", "success");
    }
    if (action === "remove") {
      if (!(await confirmDialog({ title: `Retirer ${member.name || member.email} ?`, message: "Cette personne ne pourra plus se connecter. Ses réponses passées restent dans les conversations.", confirmLabel: "Retirer de l'équipe", tone: "danger", iconName: "user-x" }))) return;
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
  if (members.length >= maxMembers) return showToast(`Votre équipe est limitée à ${maxMembers - 1} employés.`, "error");
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
