import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { confirmDialog } from "../../ui/confirm.js";
import { icon } from "../../ui/icons.js";

/** Numéros (famille, fournisseurs…) auxquels l'agent IA ne doit jamais répondre automatiquement. */

let contacts = [];

const base = () => `/organizations/${getState().organizationId}/ignored-contacts`;

function rowMarkup(contact) {
  const added = new Date(contact.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `
    <article class="list-row ignored-contact-row" data-id="${escapeHtml(contact.id)}">
      <span class="icon-tile">${icon("ban")}</span>
      <div class="list-main">
        <span class="list-title truncate">${escapeHtml(contact.label || contact.displayNumber)}</span>
        <span class="list-sub truncate">${contact.label ? `${escapeHtml(contact.displayNumber)} · ` : ""}ajouté le ${escapeHtml(added)}</span>
      </div>
      <button type="button" class="btn btn-sm btn-ghost btn-danger-ghost" data-remove="${escapeHtml(contact.id)}">${icon("trash")}Retirer</button>
    </article>`;
}

function render() {
  $("#ignored-contacts-list").innerHTML = contacts.map(rowMarkup).join("")
    || `<div class="empty empty-compact"><span class="empty-icon">${icon("ban")}</span><p class="empty-title">Aucun numéro ignoré</p><p class="empty-text">Votre agent répond à tous les numéros qui lui écrivent.</p></div>`;
}

export async function loadIgnoredContacts() {
  if (!getState().organizationId) return;
  try {
    ({ contacts } = await api(base()));
    render();
  } catch (error) {
    $("#ignored-contacts-list").innerHTML = `<div class="empty empty-compact"><p class="empty-text">${escapeHtml(error.message)}</p></div>`;
  }
}

async function addContact(event) {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(base(), {
      method: "POST",
      body: JSON.stringify({ whatsappNumber: $("#ignored-contact-number").value, label: $("#ignored-contact-label").value }),
    });
    event.target.reset();
    showToast("Numéro ajouté : votre agent ne lui répondra plus.", "success");
    await loadIgnoredContacts();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function removeContact(id) {
  const contact = contacts.find((entry) => entry.id === id);
  if (!(await confirmDialog({ title: `Retirer ${contact?.label || contact?.displayNumber || "ce numéro"} de la liste ?`, message: "Votre agent recommencera à répondre automatiquement à ce numéro.", confirmLabel: "Retirer de la liste" }))) return;
  try {
    await api(`${base()}/${id}`, { method: "DELETE" });
    showToast("Numéro retiré.", "success");
    await loadIgnoredContacts();
  } catch (error) {
    showToast(error.message, "error");
  }
}

export function initIgnoredContacts() {
  $("#ignored-contact-form").onsubmit = addContact;
  $("#ignored-contacts-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (button) void removeContact(button.dataset.remove);
  });
}
