/**
 * Apparence : clair, sombre ou « auto » (suit le réglage du téléphone ou de l'ordinateur).
 * Le thème est appliqué avant le premier affichage par src/theme-init.js ; ce module gère le choix de l'utilisateur.
 */
const STORAGE_KEY = "brayano_theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "auto" ? stored : "light";
  } catch {
    return "light";
  }
}

function apply(preference) {
  const dark = preference === "dark" || (preference === "auto" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0a0f1a" : "#f5f7fa");
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === preference;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

export function setThemePreference(preference) {
  try { localStorage.setItem(STORAGE_KEY, preference); } catch { /* stockage indisponible : le choix vaut pour cette visite */ }
  apply(preference);
}

/** Bascule rapide clair ↔ sombre (recherche rapide). */
export function toggleTheme() {
  setThemePreference(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

export function initTheme() {
  apply(getThemePreference());
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-theme-choice]");
    if (button) setThemePreference(button.dataset.themeChoice);
  });
  media.addEventListener?.("change", () => { if (getThemePreference() === "auto") apply("auto"); });
}
