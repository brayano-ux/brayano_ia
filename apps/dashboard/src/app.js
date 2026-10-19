import { $ } from "./utils/dom.js";
import { initAuthFlow, logoutUser } from "./features/auth/auth.js";
import { loadOrganizations } from "./features/organizations/organizations.js";
import { initNavigation, registerLeaveGuard, setView, UNSAVED_CHANGES_MESSAGE, updateRealtimeHeader } from "./features/navigation/navigation.js";
import { initOverview, refreshOverview } from "./features/overview/overview.js";
import { initInbox, loadInbox, openConversation, bindInboxRefresh } from "./features/inbox/inbox.js";
import { hasUnsavedAgentChanges, initAgent, loadSettings } from "./features/agent/agent.js";
import { initDelaySettings, loadDelaySettings } from "./features/settings/delay-settings.js";
import { initRoutingSettings, loadRoutingConfig } from "./features/settings/routing-settings.js";
import { loadPlatformSuspension } from "./features/suspension/suspension.js";
import { initWhatsapp, loadWhatsApp } from "./features/whatsapp/whatsapp.js";
import { initProducts, loadProducts } from "./features/products/products.js";
import { hasUnsavedAgendaChanges, initAppointments, loadAppointments } from "./features/appointments/appointments.js";
import { initOrders, loadOrders } from "./features/orders/orders.js";
import { initBroadcasts, loadBroadcastsView } from "./features/broadcasts/broadcasts.js";
import { initTeamSettings, loadTeam } from "./features/settings/team-settings.js";
import { loadRole } from "./features/navigation/roles.js";
import { initConfigAssistant } from "./features/config-assistant/config-assistant.js";
import { readSession } from "./services/storage.js";
import { isNetworkError } from "./services/api.js";
import { showToast } from "./utils/dom.js";

/**
 * Point d'entrée du dashboard. Assemble les features indépendantes
 * (auth, navigation, overview, inbox, agent, products, settings, whatsapp) sans
 * qu'aucune d'elles n'ait besoin de connaître les autres directement.
 */

async function refreshAll() {
  await Promise.all([refreshOverview(openConversation), loadPlatformSuspension()]);
}

const viewLoaders = {
  overview: refreshAll,
  inbox: () => loadInbox(),
  agent: loadSettings,
  products: loadProducts,
  appointments: loadAppointments,
  orders: loadOrders,
  broadcasts: loadBroadcastsView,
  settings: () => {
    loadDelaySettings();
    loadRoutingConfig();
    loadTeam();
  },
  whatsapp: loadWhatsApp,
};

function renderUserCard() {
  const email = readSession()?.email || "";
  const local = email.split("@")[0] || "Mon compte";
  const name = local.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  $("#user-name").textContent = name;
  $("#user-email").textContent = email || "Compte principal";
  $("#user-avatar").textContent = (name.match(/\b\w/g) || ["A"]).slice(0, 2).join("").toUpperCase();
}

async function onAuthenticated() {
  renderUserCard();
  await loadRole();
  try {
    await loadOrganizations(refreshAll);
  } catch (error) {
    showToast(isNetworkError(error) ? "API inaccessible. Réessayez plus tard." : error.message, "error");
  }
}

function initLogout() {
  const logoutButton = document.createElement("button");
  logoutButton.className = "nav-item";
  logoutButton.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-logout"/></svg><span>Se déconnecter</span>';
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
  registerLeaveGuard("agent", () => !hasUnsavedAgentChanges() || window.confirm(UNSAVED_CHANGES_MESSAGE));
  registerLeaveGuard("appointments", () => !hasUnsavedAgendaChanges() || window.confirm(UNSAVED_CHANGES_MESSAGE));
  initNavigation(viewLoaders);
  initOverview();
  initInbox();
  initAgent();
  initConfigAssistant();
  initProducts();
  initAppointments();
  initOrders();
  initBroadcasts();
  initTeamSettings();
  initDelaySettings();
  initRoutingSettings();
  initWhatsapp();
  initLogout();
  updateRealtimeHeader();
  setView("overview", viewLoaders);
  initAuthFlow(onAuthenticated);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
