import { $, $$ } from "../../utils/dom.js";
import { formatFullDate } from "../../utils/format.js";
import { getState } from "../../state/store.js";
import { APP_CONFIG } from "../../config.js";
import { maybeStartViewTour } from "../tour/tour.js";
import { confirmDialog } from "../../ui/confirm.js";
import { closeMenu } from "../../ui/menu.js";
import { setPageTitle } from "../../ui/page-title.js";
import { ADMIN_ONLY_VIEWS, isAgentRole } from "./roles.js";

/**
 * Navigation entre les vues. Chaque vue a une adresse (« #/conversations », « #/commandes »…) : le bouton
 * « retour » du navigateur ou du téléphone fonctionne, et un rafraîchissement de la page garde la vue en cours.
 */
export const VIEWS = {
  overview: { slug: "accueil", title: "Accueil" },
  inbox: { slug: "conversations", title: "Conversations" },
  orders: { slug: "commandes", title: "Commandes" },
  appointments: { slug: "rendez-vous", title: "Rendez-vous" },
  products: { slug: "produits", title: "Produits" },
  agent: { slug: "agent", title: "Agent IA" },
  broadcasts: { slug: "messages-groupes", title: "Messages groupés" },
  whatsapp: { slug: "whatsapp", title: "WhatsApp" },
  billing: { slug: "forfait", title: "Mon forfait" },
  settings: { slug: "parametres", title: "Paramètres" },
};
const VIEW_BY_SLUG = Object.fromEntries(Object.entries(VIEWS).map(([view, { slug }]) => [slug, view]));

/** Garde-fous « modifications non enregistrées » : vue → () => true s'il reste des modifications à enregistrer. */
const leaveGuards = new Map();
let loaders = {};

export function registerLeaveGuard(view, hasUnsavedChanges) {
  leaveGuards.set(view, hasUnsavedChanges);
}

export const UNSAVED_CHANGES_MESSAGE = "Vous avez des modifications non enregistrées sur cette page. Si vous continuez, elles seront perdues.";

function confirmLeave() {
  return confirmDialog({
    title: "Quitter sans enregistrer ?",
    message: UNSAVED_CHANGES_MESSAGE,
    confirmLabel: "Quitter sans enregistrer",
    cancelLabel: "Rester sur la page",
    tone: "danger",
  });
}

export function currentView() {
  const visible = $$(".view").find((section) => !section.classList.contains("hidden"));
  return visible ? visible.id.replace(/-view$/, "") : null;
}

function isShellVisible() {
  return !$(".app-shell")?.classList.contains("hidden");
}

/** Vue (et éventuel élément ouvert, ex. une conversation) désignée par l'adresse de la page. */
export function readRoute() {
  const parts = window.location.hash.replace("#", "").split("/").filter(Boolean);
  const view = VIEW_BY_SLUG[parts[0]] || null;
  return { view, detail: view && parts[1] ? decodeURIComponent(parts[1]) : null };
}

/** Vue à afficher pour l'adresse en cours, en tenant compte du rôle (un employé n'ouvre pas les réglages). */
export function routeView(fallback = "overview") {
  const { view } = readRoute();
  if (!view || (isAgentRole() && ADMIN_ONLY_VIEWS.includes(view))) return fallback;
  return view;
}

function writeRoute(view, detail, { replace = false } = {}) {
  if (!isShellVisible()) return;
  const hash = `#/${VIEWS[view]?.slug || ""}${detail ? `/${encodeURIComponent(detail)}` : ""}`;
  if (window.location.hash === hash) return;
  // On conserve les paramètres d'adresse éventuels (retour de paiement…), seul le fragment change.
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  // `pushed` : cette étape a été ajoutée à l'historique (le bouton « retour » peut donc la dépiler).
  if (replace) window.history.replaceState({ view, detail: detail || null, pushed: false }, "", url);
  else window.history.pushState({ view, detail: detail || null, pushed: true }, "", url);
}

/** Ajoute ou retire l'élément ouvert dans l'adresse (ex. « #/conversations/<id> »). */
export function setRouteDetail(view, detail, { replace = false } = {}) {
  if (currentView() !== view) return;
  writeRoute(view, detail, { replace });
}

function closeMobileMenu() {
  $("#sidebar")?.classList.remove("mobile-open");
  $("#sidebar-overlay")?.classList.remove("active");
  $("#tab-more")?.setAttribute("aria-expanded", "false");
}

function showView(view, onViewShown, { fromHistory = false, replace = false } = {}) {
  $$(".view").forEach((section) => section.classList.toggle("hidden", section.id !== `${view}-view`));
  $$(".nav-item[data-view], .tab-item[data-view]").forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  // Les vues secondaires (produits, rendez-vous…) activent « Plus » sur mobile.
  $("#tab-more")?.classList.toggle("active", !$$(".tab-item[data-view].active").some((item) => item.offsetParent !== null));
  document.body.dataset.currentView = view;
  document.body.classList.remove("in-thread");
  const title = VIEWS[view]?.title || "Tableau de bord";
  const label = $("#topbar-view");
  if (label) label.textContent = title;
  if (isShellVisible()) setPageTitle(title);
  closeMenu();
  closeMobileMenu();
  if (!fromHistory) writeRoute(view, null, { replace });
  window.scrollTo({ top: 0 });
  onViewShown?.[view]?.();
  // Pas de guide avant la connexion : la première vue est préparée alors que l'écran de connexion est encore affiché.
  if (isShellVisible()) maybeStartViewTour(view);
}

/**
 * Affiche une vue. S'il reste des modifications non enregistrées sur la vue en cours, la navigation est mise en
 * attente le temps que l'utilisateur confirme : la fonction renvoie alors `false` tout de suite.
 * Pour enchaîner une action après la navigation, utiliser `navigate()` (asynchrone).
 * @param {string} view identifiant de vue ("overview", "inbox", "agent", ...)
 * @param {Record<string, () => void>} [onViewShown] fonctions de chargement par vue
 * @returns {boolean} false si la navigation n'a pas eu lieu immédiatement
 */
export function setView(view, onViewShown, options = {}) {
  if (!VIEWS[view]) return false;
  const current = currentView();
  if (current && leaveGuards.get(current)?.()) {
    void navigate(view, onViewShown, options);
    return false;
  }
  showView(view, onViewShown, options);
  return true;
}

/** Variante asynchrone de `setView` : attend la confirmation éventuelle, puis indique si la vue est affichée. */
export async function navigate(view, onViewShown = loaders, options = {}) {
  if (!VIEWS[view]) return false;
  const current = currentView();
  if (current && leaveGuards.get(current)?.() && !(await confirmLeave())) return false;
  showView(view, onViewShown, options);
  return true;
}

export function updateRealtimeHeader() {
  const dateLabel = $("#overview-date");
  if (dateLabel) {
    const text = formatFullDate();
    dateLabel.textContent = text.charAt(0).toUpperCase() + text.slice(1);
  }
  const orgName = $("#org-select")?.selectedOptions?.[0]?.textContent || getState().organizationName || "";
  const orgLabel = $("#current-org");
  if (orgLabel && orgName) orgLabel.textContent = orgName;
}

/**
 * Câble les boutons de navigation (`data-view` / `data-view-target`), le menu mobile (feuille qui monte du bas)
 * et l'historique du navigateur.
 */
export function initNavigation(onViewShown) {
  loaders = onViewShown || {};

  // Délégation : les boutons ajoutés plus tard (cartes de l'accueil, états vides…) naviguent sans câblage.
  document.addEventListener("click", (event) => {
    const element = event.target.closest?.("[data-view], [data-view-target]");
    if (!element) return;
    const view = element.dataset.view || element.dataset.viewTarget;
    if (!VIEWS[view]) return;
    if (element.tagName === "A") event.preventDefault();
    setView(view, loaders);
  });

  const sidebar = $("#sidebar");
  const overlay = $("#sidebar-overlay");
  const toggleMenu = (open = !sidebar.classList.contains("mobile-open")) => {
    sidebar.classList.toggle("mobile-open", open);
    overlay.classList.toggle("active", open);
    $("#tab-more")?.setAttribute("aria-expanded", String(open));
  };

  overlay?.addEventListener("click", () => toggleMenu(false));
  $("#sidebar-close")?.addEventListener("click", () => toggleMenu(false));
  $("#tab-more")?.addEventListener("click", () => toggleMenu());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar.classList.contains("mobile-open")) toggleMenu(false);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > APP_CONFIG.mobileBreakpointPx) toggleMenu(false);
  });

  // Bouton « retour » : on revient à la vue précédente (ou à la liste, depuis une conversation ouverte).
  window.addEventListener("popstate", async () => {
    if (!isShellVisible()) return;
    const { detail } = readRoute();
    const view = routeView();
    const current = currentView();
    if (view !== current) {
      if (current && leaveGuards.get(current)?.() && !(await confirmLeave())) {
        writeRoute(current, null);
        return;
      }
      showView(view, loaders, { fromHistory: true });
    }
    document.dispatchEvent(new CustomEvent("brayano:route", { detail: { view, detail } }));
  });

  updateRealtimeHeader();
  setInterval(updateRealtimeHeader, 30_000);
}
