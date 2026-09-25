/**
 * Petits utilitaires DOM partagés par toutes les fonctionnalités.
 * Aucune dépendance externe : le dashboard reste 100% statique.
 */

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

let toastTimer = null;

/**
 * Affiche une notification légère en bas à droite de l'écran.
 * @param {string} message
 * @param {"info"|"success"|"error"} type
 */
export function showToast(message, type = "info") {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("show");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

export function toggleHidden(element, hidden) {
  if (element) element.classList.toggle("hidden", hidden);
}
