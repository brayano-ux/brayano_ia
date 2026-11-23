import { $ } from "./utils/dom.js";
import { initOnboarding, refreshOnboarding } from "./features/onboarding/onboarding.js";
import { initAuthFlow, logoutUser } from "./features/auth/auth.js";
import { loadOrganizations } from "./features/organizations/organizations.js";
import { currentView, initNavigation, navigate, registerLeaveGuard, routeView, setView, updateRealtimeHeader, VIEWS } from "./features/navigation/navigation.js";
import { exportProspects, initOverview, refreshOverview } from "./features/overview/overview.js";
import { initInbox, loadInbox, openConversation, bindInboxRefresh, setInboxFilter } from "./features/inbox/inbox.js";
import { hasUnsavedAgentChanges, initAgent, loadSettings, openAgentSection } from "./features/agent/agent.js";
import { initDelaySettings, loadDelaySettings } from "./features/settings/delay-settings.js";
import { initRoutingSettings, loadRoutingConfig } from "./features/settings/routing-settings.js";
import { loadPlatformSuspension } from "./features/suspension/suspension.js";
import { initWhatsapp, loadWhatsApp } from "./features/whatsapp/whatsapp.js";
import { initProducts, loadProducts, openProductForm } from "./features/products/products.js";
import { hasUnsavedAgendaChanges, initAppointments, loadAppointments } from "./features/appointments/appointments.js";
import { initOrders, loadOrders, setOrdersFilter } from "./features/orders/orders.js";
import { initBroadcasts, loadBroadcastsView } from "./features/broadcasts/broadcasts.js";
import { initHelp } from "./features/help/help.js";
import { handleChariowReturn, initBilling, loadBilling, refreshBillingBanner } from "./features/billing/billing.js";
import { initTeamSettings, loadTeam } from "./features/settings/team-settings.js";
import { initIgnoredContacts, loadIgnoredContacts } from "./features/settings/ignored-contacts.js";
import { initSettingsTabs } from "./features/settings/settings-tabs.js";
import { checkFirstLoginPersona, initPersonaPicker } from "./features/persona/persona.js";
import { ADMIN_ONLY_VIEWS, applyRole, isAgentRole, loadRole } from "./features/navigation/roles.js";
import { initConfigAssistant } from "./features/config-assistant/config-assistant.js";
import { isAuthenticated, readSession } from "./services/storage.js";
import { isNetworkError } from "./services/api.js";
import { getState } from "./state/store.js";
import { showToast } from "./utils/dom.js";
import { initials } from "./utils/format.js";
import { avatarHue } from "./ui/avatar.js";
import { confirmDialog } from "./ui/confirm.js";
import { initCommandPalette } from "./ui/command-palette.js";
import { initScrollRows } from "./ui/scroll-row.js";
import { initTheme, toggleTheme } from "./ui/theme.js";
import "./ui/menu.js";

/**
 * Point d'entrée du dashboard. Assemble les features indépendantes
 * (auth, navigation, overview, inbox, agent, products, settings, whatsapp) sans
 * qu'aucune d'elles n'ait besoin de connaître les autres directement.
 */

/** Depuis l'accueil ou la recherche rapide : affiche la boîte de réception, puis la conversation. */
async function openConversationInInbox(id) {
  if (!(await navigate("inbox", {}))) return;
  await loadInbox();
  await openConversation(id);
}

/** Ce que l'accueil sait ouvrir : une conversation, une liste filtrée, une page, une section de l'agent. */
const overviewHandlers = {
  openConversation: openConversationInInbox,
  openInbox: async (filter) => {
    if (!(await navigate("inbox", {}))) return;
    setInboxFilter(filter);
    await loadInbox();
  },
  openOrders: async (filter) => {
    if (!(await navigate("orders", {}))) return;
    setOrdersFilter(filter);
    await loadOrders();
  },
  openView: async (view, options = {}) => {
    if ((await navigate(view, viewLoaders)) && options.addProduct) openProductForm();
  },
  openAgentSection: async (tab, focus) => {
    if (await navigate("agent", viewLoaders)) openAgentSection(tab, focus);
  },
};

async function refreshAll() {
  await Promise.all([refreshOverview(overviewHandlers), loadPlatformSuspension(), refreshBillingBanner(), refreshOnboarding()]);
}

const viewLoaders = {
  overview: refreshAll,
  inbox: () => loadInbox(),
  agent: loadSettings,
  products: loadProducts,
  appointments: loadAppointments,
  orders: loadOrders,
  broadcasts: loadBroadcastsView,
  billing: loadBilling,
  settings: () => {
    loadDelaySettings();
    loadRoutingConfig();
    loadTeam();
    loadIgnoredContacts();
  },
  whatsapp: loadWhatsApp,
};

/** Nom affiché : celui du compte s'il est connu, sinon déduit de l'adresse email. */
export function displayName() {
  const session = readSession();
  if (session?.name) return session.name;
  const local = (session?.email || "").split("@")[0] || "";
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Mon compte";
}

function renderUserCard() {
  const session = readSession();
  const name = displayName();
  $("#user-name").textContent = name;
  $("#user-email").textContent = session?.role === "AGENT" ? `${session.email} · Employé` : session?.email || "Compte principal";
  const avatar = $("#user-avatar");
  avatar.textContent = initials(name);
  avatar.style.setProperty("--h", String(avatarHue(session?.email || name)));
  const greeting = $("#company-greeting");
  const firstName = session?.name ? session.name.trim().split(/\s+/)[0] : "";
  if (greeting) greeting.textContent = firstName ? `Bonjour, ${firstName}` : "Bonjour";
}

async function onAuthenticated() {
  renderUserCard();
  await loadRole();
  renderUserCard();
  try {
    await loadOrganizations(refreshAll);
    updateRealtimeHeader();
    void checkFirstLoginPersona();
    // Retour depuis la page de paiement Chariow (voir redirect_url côté serveur) : on ramène
    // l'utilisateur directement sur « Mon forfait » et on attend la confirmation de l'activation.
    if (new URLSearchParams(window.location.search).get("chariow") === "done") {
      window.history.replaceState({}, "", window.location.pathname);
      setView("billing", viewLoaders);
      void handleChariowReturn();
      return;
    }
    // L'adresse désigne peut-être une autre vue que celle préparée avant la connexion (lien direct vers une page).
    // Dans tous les cas on repasse par setView : l'écran est maintenant visible, le titre, l'adresse et le guide se mettent à jour.
    const wanted = routeView();
    setView(wanted, wanted === currentView() ? undefined : viewLoaders, { replace: true });
  } catch (error) {
    showToast(isNetworkError(error) ? "API inaccessible. Réessayez plus tard." : error.message, "error");
  }
}

function initAccountMenu() {
  $("#logout-button").onclick = async () => {
    const confirmed = await confirmDialog({
      title: "Se déconnecter ?",
      message: "Vous devrez saisir à nouveau votre email et votre mot de passe pour revenir. Votre agent continue de répondre à vos clients.",
      confirmLabel: "Se déconnecter",
      iconName: "logout",
    });
    if (confirmed) logoutUser();
  };
  const newOrgButton = $("#new-org");
  if (newOrgButton) newOrgButton.onclick = () => logoutUser("register");
}

/** Pages et actions proposées par la recherche rapide (Ctrl/⌘ + K). */
function initPalette() {
  const allowed = (view) => !(isAgentRole() && ADMIN_ONLY_VIEWS.includes(view));
  const icons = { overview: "home", inbox: "chats", orders: "bag", appointments: "calendar", products: "package", agent: "sparkles", broadcasts: "megaphone", whatsapp: "whatsapp", billing: "card", settings: "settings" };
  const keywords = {
    overview: "tableau de bord statistiques chiffres vue d'ensemble",
    inbox: "messages clients discussions boîte de réception prospects",
    orders: "ventes paiements livraisons",
    appointments: "agenda réservations créneaux",
    products: "catalogue articles photos prix",
    agent: "assistant intelligence artificielle réglages instructions horaires relances négociation",
    broadcasts: "annonce promotion diffusion campagne",
    whatsapp: "connexion numéro qr code",
    billing: "abonnement paiement plan tarifs",
    settings: "équipe employés délai numéros ignorés zones commerciaux",
  };
  const go = (view) => () => setView(view, viewLoaders);
  const agentSection = (tab, focus) => async () => {
    if (await navigate("agent", viewLoaders)) openAgentSection(tab, focus);
  };

  initCommandPalette({
    isAvailable: () => !$(".app-shell")?.classList.contains("hidden"),
    pages: () => Object.entries(VIEWS).filter(([view]) => allowed(view)).map(([view, { title }]) => ({ label: title, icon: icons[view], keywords: keywords[view], run: go(view) })),
    actions: () => [
      { label: "Ajouter un produit", icon: "plus", keywords: "catalogue article nouveau", admin: true, run: async () => { if (await navigate("products", viewLoaders)) openProductForm(); } },
      { label: "Tester mon agent", icon: "circle-play", keywords: "simulation essai", admin: true, run: agentSection("knowledge", "#agent-test-input") },
      { label: "Modifier les informations de mon entreprise", icon: "book", keywords: "connaissances horaires adresse tarifs", admin: true, run: agentSection("knowledge", "#business-info") },
      { label: "Préparer un message groupé", icon: "megaphone", keywords: "annonce promotion envoyer à tous", admin: true, run: go("broadcasts") },
      { label: "Connecter WhatsApp", icon: "whatsapp", keywords: "qr code numéro relier", admin: true, run: go("whatsapp") },
      { label: "Ajouter un employé", icon: "user-plus", keywords: "équipe collaborateur accès", admin: true, run: go("settings") },
      { label: "Exporter les prospects", hint: "Fichier CSV de tous vos clients", icon: "download", keywords: "télécharger excel csv contacts", run: () => void exportProspects() },
      { label: document.documentElement.dataset.theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre", icon: document.documentElement.dataset.theme === "dark" ? "sun" : "moon", keywords: "apparence couleur nuit jour", run: toggleTheme },
      { label: "Ouvrir l'aide", icon: "lifebuoy", keywords: "assistance support question", run: () => $("#help-toggle")?.click() },
      { label: "Se déconnecter", icon: "logout", keywords: "quitter sortir", run: () => $("#logout-button")?.click() },
    ].filter((action) => !(action.admin && isAgentRole())),
    conversations: () => (getState().conversations || []).map((conversation) => {
      const phone = String(conversation.contact?.whatsappJid || "").split("@")[0];
      return {
        label: conversation.contact?.displayName || `+${phone}`,
        hint: conversation.contact?.displayName ? `+${phone}` : "Conversation WhatsApp",
        phone,
        avatar: true,
        run: () => void openConversationInInbox(conversation.id),
      };
    }),
  });
}

function bootstrap() {
  initTheme();
  // « Voir la conversation » depuis une commande ou un rendez-vous.
  document.addEventListener("brayano:open-conversation", (event) => void openConversationInInbox(event.detail.id));
  document.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-open-help]")) $("#help-toggle")?.click();
  });
  // Le rôle mémorisé évite d'afficher un instant le menu complet à un employé (le serveur reste seul juge des droits).
  applyRole(readSession()?.role === "AGENT" ? "AGENT" : "ADMIN");
  bindInboxRefresh(refreshAll);
  registerLeaveGuard("agent", hasUnsavedAgentChanges);
  registerLeaveGuard("appointments", hasUnsavedAgendaChanges);
  initNavigation(viewLoaders);
  initOverview();
  initOnboarding(async (action) => {
    if (action === "whatsapp" || action === "inbox") { setView(action, viewLoaders); return; }
    if (!(await navigate("agent", viewLoaders))) return;
    openAgentSection("knowledge", action === "test" ? "#agent-test-input" : "#business-info");
  });
  initInbox();
  initAgent();
  initConfigAssistant();
  initProducts();
  initAppointments();
  initOrders();
  initBroadcasts();
  initBilling();
  initHelp();
  initTeamSettings();
  initIgnoredContacts();
  initSettingsTabs();
  initPersonaPicker(() => setView("whatsapp", viewLoaders));
  initDelaySettings();
  initRoutingSettings();
  initWhatsapp();
  initAccountMenu();
  initPalette();
  initScrollRows();
  // Une session déjà ouverte : on prépare directement la vue demandée par l'adresse (pas de passage par l'accueil).
  setView(isAuthenticated() ? routeView() : "overview", viewLoaders);
  initAuthFlow(onAuthenticated);
  document.getElementById("boot-splash")?.remove();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
