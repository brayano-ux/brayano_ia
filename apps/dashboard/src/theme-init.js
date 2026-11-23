// Applique le thème choisi avant le premier affichage (pas d'éclair blanc en mode sombre).
// Script classique et minuscule, chargé dans l'en-tête : il ne doit dépendre de rien.
(function () {
  var theme = "light";
  try {
    var stored = localStorage.getItem("brayano_theme");
    if (stored === "dark" || (stored === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches)) theme = "dark";
  } catch (error) { /* stockage indisponible : thème clair */ }
  document.documentElement.dataset.theme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0a0f1a" : "#f5f7fa");
})();
