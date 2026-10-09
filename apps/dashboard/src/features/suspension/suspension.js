import { api } from "../../services/api.js";
import { $ } from "../../utils/dom.js";
import { getState } from "../../state/store.js";

/**
 * Suspension de l'IA décidée par l'administrateur de la plateforme.
 * La bannière est visible sur toutes les vues et l'interrupteur « Agent IA global »
 * est bloqué tant que la suspension dure.
 */
export function applyPlatformSuspension(suspension) {
  const suspended = Boolean(suspension?.suspended);

  const banner = $("#platform-suspension-banner");
  if (banner) {
    banner.classList.toggle("hidden", !suspended);
    banner.textContent = suspended
      ? `Votre agent IA est suspendu par l'administrateur de la plateforme.${suspension.reason ? ` Motif : ${suspension.reason}.` : ""} Les messages de vos prospects arrivent toujours : vous pouvez y répondre à la main. Contactez le support pour réactiver l'agent.`
      : "";
  }

  const toggle = $("#global-ai-enabled");
  if (toggle) {
    toggle.disabled = suspended;
    toggle.title = suspended ? "Suspendu par l'administrateur de la plateforme" : "";
  }
}

export async function loadPlatformSuspension() {
  const organizationId = getState().organizationId;
  if (!organizationId) return;
  try {
    const { platformSuspension } = await api(`/organizations/${organizationId}/ai-settings`);
    applyPlatformSuspension(platformSuspension);
  } catch {
    // La bannière est une aide : une erreur réseau ne doit pas gêner le reste du tableau de bord.
  }
}
