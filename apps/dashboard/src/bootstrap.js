// Anti-« clickjacking » : le tableau de bord ne s'affiche jamais à l'intérieur d'une page d'un autre site.
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
  try { window.top.location.href = window.self.location.href; } catch { /* navigation refusée : la page reste masquée */ }
  throw new Error("Affichage dans un cadre refusé.");
}

const templatePaths = [
  "./templates/icons.html",
  "./templates/auth.html",
  "./templates/app-shell.html",
  "./templates/views/overview.html",
  "./templates/views/inbox.html",
  "./templates/views/orders.html",
  "./templates/views/appointments.html",
  "./templates/views/products.html",
  "./templates/views/agent.html",
  "./templates/views/broadcasts.html",
  "./templates/views/whatsapp.html",
  "./templates/views/billing.html",
  "./templates/views/settings.html",
  "./templates/views/clients.html",
];

async function loadTemplate(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Impossible de charger le fragment ${path}.`);
  return response.text();
}

async function bootstrapDashboard() {
  const root = document.querySelector("#app-root");
  try {
    const [icons, auth, shell, ...views] = await Promise.all(templatePaths.map(loadTemplate));
    root.innerHTML = icons + auth + shell;
    document.querySelector("#views-root").innerHTML = views.join("\n");
    await import("./app.js");
  } catch (error) {
    console.error("Échec du chargement du dashboard :", error);
    document.getElementById("boot-splash")?.remove();
    root.innerHTML = '<main class="dashboard-load-error"><h1>Le tableau de bord n’a pas pu se charger.</h1><p>Vérifiez votre connexion Internet, puis actualisez la page.</p><p><button type="button" class="btn btn-primary" id="reload-page">Actualiser la page</button></p></main>';
    document.getElementById("reload-page")?.addEventListener("click", () => window.location.reload());
  }
}

bootstrapDashboard();
