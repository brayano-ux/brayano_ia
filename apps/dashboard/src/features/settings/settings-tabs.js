import { $, $$ } from "../../utils/dom.js";

/**
 * Onglets de la page Paramètres : Réponses, Équipe, Numéros à ignorer, Zones et commerciaux.
 * Une seule section visible à la fois au lieu d'une colonne de plusieurs écrans de haut.
 */
export function openSettingsTab(tab) {
  $$("[data-settings-tab]").forEach((button) => {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$("[data-settings-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.settingsPane !== tab));
}

export function initSettingsTabs() {
  $$("[data-settings-tab]").forEach((button) => {
    button.addEventListener("click", () => openSettingsTab(button.dataset.settingsTab));
  });
  const first = $("[data-settings-tab]");
  if (first) openSettingsTab(first.dataset.settingsTab);
}
