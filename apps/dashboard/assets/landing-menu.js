// Ferme le menu du haut après un clic sur un lien (téléphone).
document.querySelectorAll(".menu-list a").forEach(function (link) {
  link.addEventListener("click", function () { link.closest("details").removeAttribute("open"); });
});
