import { api } from "../../services/api.js";
import { $, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { APP_CONFIG } from "../../config.js";

export async function loadDelaySettings() {
  try {
    const { settings } = await api(`/organizations/${getState().organizationId}/ai-settings`);
    const delay = APP_CONFIG.responseDelayOptions.includes(settings.responseDelaySeconds) ? settings.responseDelaySeconds : 3;
    const option = document.querySelector(`input[name="response-delay"][value="${delay}"]`);
    if (option) option.checked = true;
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function saveDelaySettings(event) {
  event.preventDefault();
  const selected = document.querySelector('input[name="response-delay"]:checked');
  const responseDelaySeconds = Number(selected?.value || 3);

  try {
    await api(`/organizations/${getState().organizationId}/ai-settings`, {
      method: "PUT",
      body: JSON.stringify({ responseDelaySeconds }),
    });
    showToast(`Délai enregistré : ${responseDelaySeconds >= 60 ? `${responseDelaySeconds / 60} minute(s)` : `${responseDelaySeconds} secondes`}`, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

export function initDelaySettings() {
  $("#delay-form").onsubmit = saveDelaySettings;
  $("#save-settings").onclick = () => $("#delay-form").requestSubmit();
}
