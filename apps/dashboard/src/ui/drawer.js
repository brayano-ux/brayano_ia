import { lockScroll, trapFocus, unlockScroll } from "./overlay.js";

/**
 * Panneau latéral (fiche, formulaire). Sur téléphone il monte du bas de l'écran.
 * Le balisage vit dans le gabarit de la vue : <aside class="drawer" id="…"> avec un bouton [data-drawer-close].
 */
const open = new Map(); // élément → { release, onClose, previousFocus }
let backdrop = null;

function ensureBackdrop() {
  if (backdrop) return backdrop;
  backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  backdrop.addEventListener("click", () => {
    const last = [...open.keys()].pop();
    if (last) closeDrawer(last);
  });
  document.body.append(backdrop);
  return backdrop;
}

export function isDrawerOpen(element) {
  return open.has(element);
}

/**
 * @param {HTMLElement} element
 * @param {{ onClose?: () => void, canClose?: () => boolean | Promise<boolean>, focus?: string }} options
 */
export function openDrawer(element, { onClose, canClose, focus } = {}) {
  if (!element || open.has(element)) return;
  ensureBackdrop().classList.add("open");
  element.classList.add("open");
  element.setAttribute("aria-hidden", "false");
  lockScroll();
  open.set(element, { release: trapFocus(element), onClose, canClose, previousFocus: document.activeElement });
  const target = (focus && element.querySelector(focus)) || element.querySelector("[data-drawer-close]") || element;
  // Laisse l'animation démarrer avant de déplacer le focus (évite un saut de défilement sur téléphone).
  window.setTimeout(() => target.focus?.({ preventScroll: true }), 60);
}

export async function closeDrawer(element, { force = false } = {}) {
  const entry = open.get(element);
  if (!entry) return true;
  if (!force && entry.canClose && !(await entry.canClose())) return false;
  open.delete(element);
  entry.release();
  element.classList.remove("open");
  element.setAttribute("aria-hidden", "true");
  unlockScroll();
  if (!open.size) backdrop?.classList.remove("open");
  if (entry.previousFocus instanceof HTMLElement && document.contains(entry.previousFocus)) entry.previousFocus.focus({ preventScroll: true });
  entry.onClose?.();
  return true;
}

export function closeAllDrawers() {
  for (const element of [...open.keys()]) void closeDrawer(element, { force: true });
}

document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-drawer-close]");
  if (!button) return;
  const drawer = button.closest(".drawer");
  if (drawer) void closeDrawer(drawer);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !open.size) return;
  // Une fenêtre de confirmation ouverte par-dessus gère elle-même la touche Échap.
  if (document.querySelector(".modal")) return;
  const last = [...open.keys()].pop();
  void closeDrawer(last);
});
