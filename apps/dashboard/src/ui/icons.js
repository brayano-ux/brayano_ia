/**
 * Icônes du tableau de bord : les tracés vivent dans src/templates/icons.html (chargé une fois au démarrage).
 * `icon("check")` renvoie le balisage à insérer dans une chaîne HTML.
 */
export function icon(name, className = "") {
  return `<svg class="icon${className ? ` ${className}` : ""}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}
