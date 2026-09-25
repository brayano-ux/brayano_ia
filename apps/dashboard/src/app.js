import { $ } from "./utils/dom.js";
import { initAuthFlow, logoutUser } from "./features/auth/auth.js";
import { loadOrganizations } from "./features/organizations/organizations.js";
import { initNavigation, setView, updateRealtimeHeader } from "./features/navigation/navigation.js";
import { initOverview, refreshOverview } from "./features/overview/overview.js";
import { initInbox, renderInbox, openConversation, bindInboxRefresh } from "./features/inbox/inbox.js";
import { initAgent, loadSettings } from "./features/agent/agent.js";
import { initDelaySettings, loadDelaySettings } from "./features/settings/delay-settings.js";
import { initRoutingSettings, loadRoutingConfig } from "./features/settings/routing-settings.js";
import { initWhatsapp, loadWhatsApp } from "./features/whatsapp/whatsapp.js";
import { isNetworkError } from "./services/api.js";
import { showToast } from "./utils/dom.js";

/**
 * Point d'entrée du dashboard. Assemble les features indépendantes
 * (auth, navigation, overview, inbox, agent, settings, whatsapp) sans
 * qu'aucune d'elles n'ait besoin de connaître les autres directement.
 */

async function refreshAll() {
  await refreshOverview(openConversation);
}

const viewLoaders = {
  overview: refreshAll,
  inbox: renderInbox,
  agent: loadSettings,
  settings: () => {
    loadDelaySettings();
    loadRoutingConfig();
  },
  whatsapp: loadWhatsApp,
};

async function onAuthenticated() {
  try {
    await loadOrganizations(refreshAll);
  } catch (error) {
    showToast(isNetworkError(error) ? "API inaccessible. Réessayez plus tard." : error.message, "error");
  }
}

function initLogout() {
  const logoutButton = document.createElement("button");
  logoutButton.className = "nav-item";
  logoutButton.innerHTML = "<span>⇠</span> Se déconnecter";
  logoutButton.onclick = () => {
    if (window.confirm("Voulez-vous vraiment vous déconnecter ?")) {
      logoutUser();
    }
  };
  $(".sidebar-bottom").appendChild(logoutButton);

  const newOrgButton = $("#new-org");
  if (newOrgButton) {
    newOrgButton.onclick = () => logoutUser("register");
  }
}

function bootstrap() {
  bindInboxRefresh(refreshAll);
  initNavigation(viewLoaders);
  initOverview();
  initInbox();
  initAgent();
  initDelaySettings();
  initRoutingSettings();
  initWhatsapp();
  initLogout();
  updateRealtimeHeader();
  setView("overview", viewLoaders);
  initAuthFlow(onAuthenticated);
}

document.addEventListener("DOMContentLoaded", bootstrap);
