const templatePaths = [
  "./templates/auth.html",
  "./templates/app-shell.html",
  "./templates/views/overview.html",
  "./templates/views/inbox.html",
  "./templates/views/agent.html",
  "./templates/views/products.html",
  "./templates/views/appointments.html",
  "./templates/views/orders.html",
  "./templates/views/settings.html",
  "./templates/views/whatsapp.html",
];

async function loadTemplate(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Impossible de charger le fragment ${path}.`);
  return response.text();
}

async function bootstrapDashboard() {
  const root = document.querySelector("#app-root");
  try {
    const [auth, shell, ...views] = await Promise.all(templatePaths.map(loadTemplate));
    root.innerHTML = auth + shell;
    document.querySelector("#views-root").innerHTML = views.join("\n");
    await import("./app.js");
  } catch (error) {
    console.error("Échec du chargement du dashboard :", error);
    root.innerHTML = '<main class="dashboard-load-error"><h1>Le dashboard n’a pas pu se charger.</h1><p>Vérifiez le serveur puis actualisez la page.</p></main>';
  }
}

bootstrapDashboard();
