/**
 * Menus déroulants. Un bouton portant data-menu="identifiant" ouvre l'élément .menu de cet identifiant.
 * Tout est géré par délégation : les menus créés après coup (lignes de liste) fonctionnent sans câblage.
 */
let current = null; // { menu, trigger }

function items(menu) {
  return Array.from(menu.querySelectorAll(".menu-item:not([disabled])")).filter((item) => item.offsetParent !== null);
}

export function closeMenu({ restoreFocus = false } = {}) {
  if (!current) return;
  const { menu, trigger } = current;
  current = null;
  menu.classList.remove("open", "menu-flip-up");
  trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger.focus({ preventScroll: true });
}

function openMenu(trigger, menu) {
  closeMenu();
  current = { menu, trigger };
  menu.classList.add("open");
  trigger.setAttribute("aria-expanded", "true");
  // Un menu trop bas pour l'écran s'ouvre vers le haut.
  if (!menu.classList.contains("menu-up")) {
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8 && rect.height < trigger.getBoundingClientRect().top) menu.classList.add("menu-flip-up");
  }
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest?.("[data-menu]");
  if (trigger) {
    const menu = document.getElementById(trigger.dataset.menu) || trigger.parentElement?.querySelector(".menu");
    if (!menu) return;
    event.preventDefault();
    if (current?.menu === menu) closeMenu();
    else openMenu(trigger, menu);
    return;
  }
  if (!current) return;
  const inside = event.target.closest?.(".menu");
  // Un clic sur une action referme le menu ; un clic sur un réglage interne (choix du thème…) le laisse ouvert.
  if (inside === current.menu && !event.target.closest(".menu-item")) return;
  closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (!current) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu({ restoreFocus: true });
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const list = items(current.menu);
  if (!list.length) return;
  event.preventDefault();
  const index = list.indexOf(document.activeElement);
  const next = event.key === "ArrowDown" ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
  list[next].focus();
});

window.addEventListener("resize", () => closeMenu());
