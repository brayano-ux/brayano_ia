import { lockScroll, trapFocus, unlockScroll } from "../ui/overlay.js";

/**
 * Petite fenêtre de saisie (remplace window.prompt) : le mot de passe est masqué, le texte n'est jamais interprété comme du HTML.
 * Renvoie un objet { nom_du_champ: valeur }, ou null si l'utilisateur annule.
 * @param {{ title: string, intro?: string, confirmLabel?: string, fields: Array<{ name: string, label: string, type?: "text" | "password", minLength?: number, autocomplete?: string, inputMode?: string, placeholder?: string, value?: string }> }} options
 */
export function askFields({ title, intro = "", confirmLabel = "Valider", fields }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "modal";

    const card = document.createElement("form");
    card.className = "modal-card";
    card.noValidate = false;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");

    const heading = document.createElement("h2");
    heading.textContent = title;
    card.append(heading);
    if (intro) {
      const text = document.createElement("p");
      text.className = "modal-text";
      text.textContent = intro;
      card.append(text);
    }

    const inputs = fields.map((field) => {
      const label = document.createElement("label");
      label.className = "field";
      const caption = document.createElement("span");
      caption.className = "field-label";
      caption.textContent = field.label;
      const input = document.createElement("input");
      input.type = field.type === "password" ? "password" : "text";
      input.name = field.name;
      input.required = true;
      if (field.minLength) input.minLength = field.minLength;
      if (field.autocomplete) input.autocomplete = field.autocomplete;
      if (field.inputMode) input.inputMode = field.inputMode;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.value) input.value = field.value;
      label.append(caption, input);
      card.append(label);
      return input;
    });

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = "Annuler";
    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = "btn btn-primary";
    confirm.textContent = confirmLabel;
    actions.append(cancel, confirm);
    card.append(actions);
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
    // La page change ou la session se termine : la saisie est abandonnée.
    const dismiss = () => close(null);
    document.addEventListener("brayano:close-overlays", dismiss);
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    card.addEventListener("submit", (event) => {
      event.preventDefault();
      close(Object.fromEntries(inputs.map((input) => [input.name, input.value])));
    });
    cancel.addEventListener("click", () => close(null));
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) close(null); });

    lockScroll();
    document.body.append(overlay);
    inputs[0]?.focus();
  });
}
