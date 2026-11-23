import { icon } from "./icons.js";
import { lockScroll, trapFocus, unlockScroll } from "./overlay.js";

/**
 * Fenêtre de confirmation aux couleurs du tableau de bord (remplace la boîte grise du navigateur).
 * Le texte est inséré tel quel, jamais interprété comme du HTML.
 * @param {{ title: string, message?: string, confirmLabel?: string, cancelLabel?: string, tone?: "primary" | "danger", iconName?: string }} options
 * @returns {Promise<boolean>} true si l'utilisateur confirme
 */
export function confirmDialog({ title, message = "", confirmLabel = "Confirmer", cancelLabel = "Annuler", tone = "primary", iconName }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "modal confirm-dialog";

    const card = document.createElement("div");
    card.className = "modal-card";
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");

    const head = document.createElement("div");
    head.className = "modal-head";
    const tile = document.createElement("span");
    tile.className = `icon-tile ${tone === "danger" ? "danger" : "primary-tile"}`;
    tile.innerHTML = icon(iconName || (tone === "danger" ? "alert" : "help"));
    const texts = document.createElement("div");
    texts.className = "stack-sm";
    const heading = document.createElement("h2");
    heading.id = `confirm-title-${Date.now()}`;
    heading.textContent = title;
    texts.append(heading);
    if (message) {
      for (const paragraph of String(message).split(/\n{2,}/)) {
        const text = document.createElement("p");
        text.className = "modal-text";
        text.textContent = paragraph;
        texts.append(text);
      }
    }
    head.append(tile, texts);
    card.setAttribute("aria-labelledby", heading.id);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.dataset.confirm = "cancel";
    cancel.textContent = cancelLabel;
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = `btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`;
    confirm.dataset.confirm = "ok";
    confirm.textContent = confirmLabel;
    actions.append(cancel, confirm);

    card.append(head, actions);
    overlay.append(card);

    const releaseFocus = trapFocus(card);
    const close = (value) => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("brayano:close-overlays", dismiss);
      releaseFocus();
      unlockScroll();
      overlay.remove();
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
      resolve(value);
    };
    // La page change ou la session se termine : la question n'a plus d'objet, elle vaut « non ».
    const dismiss = () => close(false);
    document.addEventListener("brayano:close-overlays", dismiss);
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) close(false); });

    lockScroll();
    document.body.append(overlay);
    // Une action irréversible ne doit pas partir sur un simple appui sur Entrée : le focus va sur « Annuler ».
    (tone === "danger" ? cancel : confirm).focus();
  });
}
