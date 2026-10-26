/**
 * Petite fenêtre de saisie (remplace window.prompt) : le mot de passe est masqué, le texte n'est jamais interprété comme du HTML.
 * Renvoie un objet { nom_du_champ: valeur }, ou null si l'utilisateur annule.
 * @param {{ title: string, intro?: string, confirmLabel?: string, fields: Array<{ name: string, label: string, type?: "text" | "password", minLength?: number, autocomplete?: string, inputMode?: string, placeholder?: string }> }} options
 */
export function askFields({ title, intro = "", confirmLabel = "Valider", fields }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const card = document.createElement("form");
    card.className = "modal-card";
    card.noValidate = false;

    const heading = document.createElement("h2");
    heading.textContent = title;
    card.append(heading);
    if (intro) {
      const text = document.createElement("p");
      text.className = "muted";
      text.textContent = intro;
      card.append(text);
    }

    const inputs = fields.map((field) => {
      const label = document.createElement("label");
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
      label.append(caption, input);
      card.append(label);
      return input;
    });

    const actions = document.createElement("div");
    actions.className = "form-actions";
    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = "primary";
    confirm.textContent = confirmLabel;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "text-button";
    cancel.textContent = "Annuler";
    actions.append(confirm, cancel);
    card.append(actions);
    overlay.append(card);

    const close = (value) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(value);
    };
    const onKey = (event) => { if (event.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    card.addEventListener("submit", (event) => {
      event.preventDefault();
      close(Object.fromEntries(inputs.map((input) => [input.name, input.value])));
    });
    cancel.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(null); });

    document.body.append(overlay);
    inputs[0]?.focus();
  });
}
