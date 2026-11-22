/**
 * Outils communs aux fenêtres, panneaux et menus : garder le clavier à l'intérieur, bloquer le défilement de la page
 * derrière, et rendre le focus à l'élément d'origine à la fermeture.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter((element) => element.offsetParent !== null || element === document.activeElement);
}

/** Garde la touche Tab à l'intérieur de `container`. Renvoie la fonction qui retire le piège. */
export function trapFocus(container) {
  const onKeydown = (event) => {
    if (event.key !== "Tab") return;
    const items = focusableIn(container);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener("keydown", onKeydown);
  return () => container.removeEventListener("keydown", onKeydown);
}

let locks = 0;

/** Empêche la page de défiler derrière une fenêtre. Chaque appel doit être suivi d'un `unlockScroll()`. */
export function lockScroll() {
  locks += 1;
  if (locks === 1) document.documentElement.classList.add("scroll-locked");
}

export function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks === 0) document.documentElement.classList.remove("scroll-locked");
}
