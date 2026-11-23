/**
 * Petits utilitaires DOM partagés par toutes les fonctionnalités.
 * Aucune dépendance externe : le dashboard reste 100% statique.
 */
import { icon } from "../ui/icons.js";

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/**
 * Échappe les caractères HTML sensibles avant une insertion via innerHTML.
 * Toute donnée provenant de l'API (noms de contact, messages, etc.) doit
 * passer par cette fonction avant d'être injectée dans le DOM.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TOAST_ICONS = { success: "check-circle", error: "x-circle", info: "info" };
const MAX_TOASTS = 3;

function toastRegion() {
  let region = $("#toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "toast-region";
    region.className = "toast-region";
    document.body.append(region);
  }
  return region;
}

function dismissToast(toast) {
  if (!toast.isConnected || toast.classList.contains("leaving")) return;
  clearTimeout(toast.hideTimer);
  toast.classList.add("leaving");
  toast.addEventListener("animationend", () => toast.remove(), { once: true });
  // Filet de sécurité si l'animation est désactivée (mouvement réduit).
  window.setTimeout(() => toast.remove(), 400);
}

/**
 * Affiche une notification légère (en bas à droite sur ordinateur, au-dessus des onglets sur téléphone).
 * Plusieurs notifications s'empilent ; une erreur reste affichée plus longtemps qu'une confirmation.
 * @param {string} message
 * @param {"info"|"success"|"error"} type
 */
export function showToast(message, type = "info") {
  if (!message) return;
  const text = String(message);
  const kind = TOAST_ICONS[type] ? type : "info";
  const region = toastRegion();
  const duration = kind === "error" ? 6500 : 3800;

  // Le même message déjà à l'écran : on prolonge simplement son affichage.
  const existing = Array.from(region.children).find((element) => element.dataset.message === text && !element.classList.contains("leaving"));
  if (existing) {
    clearTimeout(existing.hideTimer);
    existing.hideTimer = window.setTimeout(() => dismissToast(existing), duration);
    return;
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.type = kind;
  toast.dataset.message = text;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  toast.innerHTML = `<span class="toast-icon">${icon(TOAST_ICONS[kind])}</span><span class="toast-text"></span><button type="button" class="toast-close" aria-label="Fermer">${icon("close", "icon-xs")}</button>`;
  toast.querySelector(".toast-text").textContent = text;
  toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));
  toast.addEventListener("mouseenter", () => clearTimeout(toast.hideTimer));
  toast.addEventListener("mouseleave", () => { toast.hideTimer = window.setTimeout(() => dismissToast(toast), 1800); });
  region.append(toast);
  toast.hideTimer = window.setTimeout(() => dismissToast(toast), duration);

  const visible = Array.from(region.children).filter((element) => !element.classList.contains("leaving"));
  visible.slice(0, Math.max(0, visible.length - MAX_TOASTS)).forEach(dismissToast);
}

export function toggleHidden(element, hidden) {
  if (element) element.classList.toggle("hidden", hidden);
}

/** Exécute `callback` au plus une fois toutes les `delay` millisecondes après la dernière frappe (recherche, filtres). */
export function debounce(callback, delay = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}
