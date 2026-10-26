// Déjà connecté ? On va directement au tableau de bord (ajoutez ?accueil à l'adresse pour voir la page d'accueil quand même).
try {
  var session = JSON.parse(localStorage.getItem("brayano_session") || "null");
  if (session && session.token && session.email && location.search.indexOf("accueil") === -1) {
    document.documentElement.style.visibility = "hidden";
    location.replace("app/");
  }
} catch (error) { /* stockage indisponible : on affiche la page d'accueil */ }
