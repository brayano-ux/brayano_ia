import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { formatDateTime } from "../../utils/format.js";
import { getState } from "../../state/store.js";

/** Numéros (famille, fournisseurs…) auxquels l'agent IA ne doit jamais répondre automatiquement. */

let contacts = [];

const base = () => `/organizations/${getState().organizationId}/ignored-contacts`;

function rowMarkup(contact) {
  return `
    <article class="ignored-contact-row" data-id="${escapeHtml(contact.id)}">
      <div>
        <strong>${escapeHtml(contact.displayNumber)}</strong>
        ${contact.label ? `<small class="muted"> · ${escapeHtml(contact.label)}</small>` : ""}
      </div>
      <small class="muted">Ajouté le ${escapeHtml(formatDateTime(contact.createdAt))}</small>
      <button type="button" class="text-button danger-text" data-remove="${escapeHtml(contact.id)}">Retirer</button>
    </article>`;
}

function render() {
  $("#ignored-contacts-list").innerHTML = contacts.map(rowMarkup).join("") || '<div class="empty-state">Aucun numéro ignoré pour l’instant.</div>';
}

export async function loadIgnoredContacts() {
  if (!getState().organizationId) return;
  try {
    ({ contacts } = await api(base()));
    render();
  } catch (error) {
    $("#ignored-contacts-list").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
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
  if (!window.confirm(`Retirer ${contact?.label || contact?.displayNumber || "ce numéro"} de la liste ? Votre agent recommencera à lui répondre.`)) return;
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
