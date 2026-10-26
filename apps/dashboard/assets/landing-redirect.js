// Déjà connecté ? On va directement au tableau de bord (ajoutez ?accueil à l'adresse pour voir la page d'accueil quand même).
try {
  var session = JSON.parse(localStorage.getItem("brayano_session") || "null");
  if (session && session.token && session.email && location.search.indexOf("accueil") === -1) {
    document.documentElement.style.visibility = "hidden";
    location.replace("app/");
  } else {
    countLandingVisit();
  }
} catch (error) {
  // Stockage indisponible (navigation privée…) : on affiche la page d'accueil et on compte quand même la visite.
  countLandingVisit();
}

/**
 * Compteur de visites anonyme, sans cookie : un simple signal au serveur à chaque chargement de la page.
 * Le serveur ne garde ni adresse IP ni identifiant lisible (voir apps/backend/src/analytics/landing-views.service.ts).
 */
function countLandingVisit() {
  try {
    var isLocal = ["localhost", "127.0.0.1"].indexOf(location.hostname) !== -1;
    var base = (window.API_BASE_URL && /^https?:\/\//.test(window.API_BASE_URL)) ? window.API_BASE_URL : (isLocal ? "http://127.0.0.1:3000" : "https://brayano-ia-5.onrender.com");
    var url = base.replace(/\/+$/, "") + "/analytics/landing-view";
    if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([], { type: "text/plain" }));
    else fetch(url, { method: "POST", keepalive: true, mode: "cors" }).catch(function () {});
  } catch (error) {
    // Un souci de comptage ne doit jamais gêner l'affichage de la page.
  }
}
