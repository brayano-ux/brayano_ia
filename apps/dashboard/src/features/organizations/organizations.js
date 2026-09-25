import { api } from "../../services/api.js";
import { readSession, writeOrganizationId } from "../../services/storage.js";
import { $, escapeHtml } from "../../utils/dom.js";
import { getState, setState } from "../../state/store.js";

/**
 * Charge les organisations accessibles à l'utilisateur connecté et
 * peuple le sélecteur d'espace de travail dans la sidebar.
 * @param {() => Promise<void>} onOrganizationReady rafraîchit le reste du dashboard
 */
export async function loadOrganizations(onOrganizationReady) {
  const data = await api("/organizations");
  const select = $("#org-select");
  const orgPicker = $(".org-picker");
  const session = readSession();
  const organizations = data.organizations || [];
  const availableOrgId = session?.organizationId || getState().organizationId;

  if (!organizations.length) {
    if (orgPicker) orgPicker.classList.add("hidden");
    return;
  }

  const filteredOrganizations = availableOrgId
    ? organizations.filter((org) => org.id === availableOrgId)
    : organizations;
  const visibleOrganizations = filteredOrganizations.length ? filteredOrganizations : organizations;

  if (orgPicker) {
    orgPicker.classList.toggle("hidden", visibleOrganizations.length <= 1);
  }

  if (!visibleOrganizations.length) {
    select.innerHTML = "<option>Aucune entreprise</option>";
    return;
  }

  select.innerHTML = visibleOrganizations
    .map((org) => `<option value="${escapeHtml(org.id)}">${escapeHtml(org.name)}</option>`)
    .join("");

  const organizationId = visibleOrganizations.some((org) => org.id === availableOrgId)
    ? availableOrgId
    : visibleOrganizations[0].id;
  const organizationName = visibleOrganizations.find((org) => org.id === organizationId)?.name
    || visibleOrganizations[0].name
    || "Brayano";

  setState({ organizationId, organizationName, organizations });
  writeOrganizationId(organizationId);
  select.value = organizationId;

  select.onchange = () => {
    const nextName = organizations.find((org) => org.id === select.value)?.name || "Brayano";
    setState({ organizationId: select.value, organizationName: nextName });
    writeOrganizationId(select.value);
    onOrganizationReady();
  };

  onOrganizationReady();
}
