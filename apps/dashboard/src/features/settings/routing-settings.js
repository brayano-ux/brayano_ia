import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { getState, setState } from "../../state/store.js";

/**
 * Feature "Zones et responsables" : configuration du routage commercial
 * des prospects qualifiés (localisation -> responsable -> fallback).
 */

function resetResponsibleForm() {
  setState({ editingResponsibleId: null });
  $("#responsible-form").reset();
  $("#responsible-active").checked = true;
  $("#responsible-id").value = "";
  $("#responsible-form button[type=submit]").textContent = "Enregistrer le responsable";
  $("#cancel-responsible-edit").classList.add("hidden");
}

function startResponsibleEdit(responsibleId, locations) {
  const person = locations.flatMap((location) => location.responsible || []).find((entry) => entry.id === responsibleId);
  if (!person) return;

  setState({ editingResponsibleId: person.id });
  $("#responsible-id").value = person.id;
  $("#responsible-location").value = person.locationId;
  $("#responsible-name").value = person.name;
  $("#responsible-whatsapp").value = person.whatsappNumber;
  $("#responsible-active").checked = person.active;
  $("#responsible-form button[type=submit]").textContent = "Enregistrer les modifications";
  $("#cancel-responsible-edit").classList.remove("hidden");
  $("#responsible-form").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteResponsibleConfig(responsibleId) {
  const confirmed = window.confirm("Supprimer définitivement ce commercial ? Les anciens prospects seront conservés, mais ne seront plus liés à ce commercial.");
  if (!confirmed) return;

  try {
    await api(`/organizations/${getState().organizationId}/responsibles/${responsibleId}`, { method: "DELETE" });
    if (getState().editingResponsibleId === responsibleId) resetResponsibleForm();
    showToast("Commercial supprimé définitivement.", "success");
    await loadRoutingConfig();
  } catch (error) {
    showToast(error.message || "Impossible de supprimer le commercial.", "error");
  }
}

export async function loadRoutingConfig() {
  try {
    const { locations = [], settings = null } = await api(`/organizations/${getState().organizationId}/routing`);
    const list = $("#routing-locations-list");
    const locationSelect = $("#responsible-location");
    const fallbackSelect = $("#fallback-responsible");

    if (!list) return;

    if (locationSelect) {
      locationSelect.innerHTML = locations.length
        ? locations.map((location) => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)} — ${escapeHtml(location.city)}</option>`).join("")
        : '<option value="">Aucune zone disponible</option>';
    }

    if (!locations.length) {
      list.innerHTML = '<div class="empty-state">Aucune zone configurée pour le moment.</div>';
    } else {
      list.innerHTML = locations
        .map((location) => {
          const responsible = (location.responsible || [])
            .map(
              (person) => `
            <li class="routing-responsible">
              <span>${escapeHtml(person.name)} — ${escapeHtml(person.whatsappNumber)}${person.active ? "" : " (inactif)"}</span>
              <span class="routing-actions">
                <button type="button" class="text-button" data-edit-responsible="${escapeHtml(person.id)}">Modifier</button>
                <button type="button" class="text-button danger-text" data-delete-responsible="${escapeHtml(person.id)}">Supprimer</button>
              </span>
            </li>
          `,
            )
            .join("") || "<li>Aucun responsable</li>";
          return `
            <div class="routing-item">
              <div>
                <strong>${escapeHtml(location.name)}</strong>
                <small>${escapeHtml(location.city)}</small>
              </div>
              <ul>${responsible}</ul>
            </div>
          `;
        })
        .join("");

      list.querySelectorAll("[data-edit-responsible]").forEach((button) => {
        button.onclick = () => startResponsibleEdit(button.dataset.editResponsible, locations);
      });
      list.querySelectorAll("[data-delete-responsible]").forEach((button) => {
        button.onclick = () => deleteResponsibleConfig(button.dataset.deleteResponsible);
      });
    }

    if (fallbackSelect) {
      fallbackSelect.innerHTML =
        '<option value="">Aucun responsable</option>' +
        locations
          .flatMap((location) =>
            (location.responsible || [])
              .filter((person) => person.active)
              .map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)} — ${escapeHtml(location.name)}</option>`),
          )
          .join("");
      fallbackSelect.value = settings?.fallbackResponsibleId || "";
    }

    const fallbackInput = $("#fallback-whatsapp");
    if (fallbackInput) fallbackInput.value = settings?.fallbackWhatsApp || "";
  } catch (error) {
    showToast(error.message || "Impossible de charger la configuration de routage.", "error");
  }
}

async function saveLocationConfig(event) {
  event.preventDefault();
  const payload = {
    name: $("#location-name").value,
    city: $("#location-city").value,
    recipientWhatsApp: $("#location-recipient-whatsapp").value,
    active: true,
  };

  try {
    await api(`/organizations/${getState().organizationId}/locations`, { method: "POST", body: JSON.stringify(payload) });
    $("#location-form").reset();
    showToast("Zone enregistrée.", "success");
    await loadRoutingConfig();
  } catch (error) {
    showToast(error.message || "Impossible d'enregistrer la zone.", "error");
  }
}

async function saveResponsibleConfig(event) {
  event.preventDefault();
  const editingResponsibleId = getState().editingResponsibleId;
  const wasEditing = Boolean(editingResponsibleId);
  const payload = {
    locationId: $("#responsible-location").value,
    name: $("#responsible-name").value,
    whatsappNumber: $("#responsible-whatsapp").value,
    active: $("#responsible-active").checked,
  };

  try {
    await api(
      editingResponsibleId
        ? `/organizations/${getState().organizationId}/responsibles/${editingResponsibleId}`
        : `/organizations/${getState().organizationId}/responsibles`,
      { method: editingResponsibleId ? "PUT" : "POST", body: JSON.stringify(payload) },
    );
    resetResponsibleForm();
    showToast(wasEditing ? "Commercial modifié." : "Responsable enregistré.", "success");
    await loadRoutingConfig();
  } catch (error) {
    showToast(error.message || "Impossible d'enregistrer le responsable.", "error");
  }
}

async function saveFallbackConfig(event) {
  event.preventDefault();
  const payload = {
    fallbackResponsibleId: $("#fallback-responsible").value || null,
    fallbackWhatsApp: $("#fallback-whatsapp").value || null,
    active: true,
  };

  try {
    await api(`/organizations/${getState().organizationId}/routing/fallback`, { method: "PUT", body: JSON.stringify(payload) });
    showToast("Fallback enregistré.", "success");
    await loadRoutingConfig();
  } catch (error) {
    showToast(error.message || "Impossible d'enregistrer le fallback.", "error");
  }
}

export function initRoutingSettings() {
  $("#location-form").onsubmit = saveLocationConfig;
  $("#responsible-form").onsubmit = saveResponsibleConfig;
  $("#cancel-responsible-edit").onclick = resetResponsibleForm;
  $("#fallback-form").onsubmit = saveFallbackConfig;
}
