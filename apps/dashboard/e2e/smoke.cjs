/**
 * Parcours de fumée du tableau de bord, exécuté par la CI (voir .github/workflows/ci.yml) :
 *   1. l'écran de connexion s'affiche, le bouton « afficher le mot de passe » fonctionne ;
 *   2. la connexion avec le compte administrateur configuré (DEFAULT_ADMIN_EMAIL / PASSWORD) aboutit ;
 *   3. chaque page s'ouvre sans erreur JavaScript, avec sa propre adresse ; « retour » et « actualiser » la respectent ;
 *   4. l'accueil affiche ses blocs, la pastille d'en-tête reflète l'état WhatsApp ;
 *   5. la recherche rapide, le thème, l'aide, les onglets des paramètres et des rendez-vous répondent ;
 *   6. un produit peut être ajouté puis supprimé (panneau latéral, menu, fenêtre de confirmation) ;
 *   7. l'agent signale les modifications non enregistrées et demande confirmation avant de quitter la page ;
 *   8. la page d'accueil publique s'affiche et ses animations démarrent ;
 *   9. sur mobile : barre d'onglets, menu « Plus », et aucune page ne dépasse la largeur de l'écran.
 *
 * Variables : DASHBOARD_URL (défaut http://127.0.0.1:4173), E2E_EMAIL, E2E_PASSWORD.
 */
const { chromium } = require("playwright");

const BASE = process.env.DASHBOARD_URL || "http://127.0.0.1:4173";
const EMAIL = process.env.E2E_EMAIL || "demo@brayano.test";
const PASSWORD = process.env.E2E_PASSWORD || "DemoPassword123";
/** Vue → fragment d'adresse attendu (voir src/features/navigation/navigation.js). */
const VIEWS = {
  overview: "accueil", inbox: "conversations", orders: "commandes", appointments: "rendez-vous", products: "produits",
  agent: "agent", broadcasts: "messages-groupes", whatsapp: "whatsapp", billing: "forfait", settings: "parametres",
};

/** Les guides pas à pas (un par page, à la première visite) couvrent l'écran : on les marque « déjà vus » avant de charger. */
const TOUR_VIEWS = ["overview", "whatsapp", "agent", "inbox", "products", "broadcasts", "nouveautes"];
async function skipTours(context) {
  await context.addInitScript((views) => {
    try { for (const view of views) localStorage.setItem(`brayano_tour_seen:${view}`, "1"); } catch { /* stockage indisponible */ }
  }, TOUR_VIEWS);
}

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  // Les ressources externes (pixel, Google) peuvent être bloquées par le réseau de la CI : seules les vraies erreurs JavaScript comptent.
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|favicon|facebook|fonts\.g|gsi|net::ERR/i.test(message.text())) errors.push(`console: ${message.text()}`); });
  return errors;
}

async function login(page, failures) {
  await page.goto(`${BASE}/app/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-email", { timeout: 20_000 });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PASSWORD);
  if (failures) {
    await page.click('.password-toggle[data-target="login-password"]');
    if ((await page.getAttribute("#login-password", "type")) !== "text") failures.push("Connexion : le bouton « afficher le mot de passe » ne montre pas la saisie.");
    await page.click('.password-toggle[data-target="login-password"]');
    if ((await page.getAttribute("#login-password", "type")) !== "password") failures.push("Connexion : le mot de passe ne se masque pas de nouveau.");
  }
  await page.click("#login-form button[type=submit]");
  await page.waitForSelector(".app-shell:not(.hidden)", { timeout: 20_000 });
  // L'accueil est prêt quand la liste « À traiter » a remplacé son squelette de chargement.
  await page.waitForFunction(() => document.querySelector("#todo-list") && !document.querySelector("#todo-list .skeleton"), null, { timeout: 20_000 });
}

/**
 * Ferme ce qui peut recouvrir la page : la fenêtre de première connexion (elle arrive quelques instants après la
 * connexion, une fois l'entreprise chargée) et un éventuel guide. On insiste un peu, car ces fenêtres apparaissent
 * de façon asynchrone.
 */
async function dismissOverlays(page, attempts = 6) {
  for (let i = 0; i < attempts; i += 1) {
    let closed = false;
    for (const selector of ["#persona-skip", ".tour-skip"]) {
      const element = page.locator(selector).first();
      if (await element.count() && await element.isVisible().catch(() => false)) {
        await element.click().catch(() => {});
        await page.waitForTimeout(250);
        closed = true;
      }
    }
    if (!closed && i > 0) return;
    await page.waitForTimeout(400);
  }
}

/** Clique un élément en refermant d'abord toute fenêtre qui intercepterait le clic. */
async function clickNav(page, selector) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissOverlays(page, attempt === 0 ? 2 : 6);
    try {
      await page.click(selector, { timeout: 5_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

const hash = (page) => page.evaluate(() => window.location.hash);

async function desktopJourney(browser, failures) {
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await skipTours(desktop);
  const page = await desktop.newPage();
  const errors = watchErrors(page);

  await login(page, failures);
  await dismissOverlays(page);

  // ---- Chaque page s'ouvre, avec sa propre adresse
  for (const [view, slug] of Object.entries(VIEWS)) {
    await clickNav(page, `.nav-item[data-view="${view}"]`);
    await page.waitForTimeout(600);
    if (!(await page.isVisible(`#${view}-view`))) failures.push(`La page « ${view} » ne s'affiche pas.`);
    if ((await hash(page)) !== `#/${slug}`) failures.push(`La page « ${view} » n'a pas l'adresse attendue (#/${slug}, obtenu : ${await hash(page)}).`);
  }

  // ---- « Retour » ramène à la page précédente ; « actualiser » garde la page en cours
  await page.goBack();
  await page.waitForTimeout(400);
  if (!(await page.isVisible("#billing-view"))) failures.push("Le bouton « retour » du navigateur ne ramène pas à la page précédente.");
  await clickNav(page, '.nav-item[data-view="orders"]');
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell:not(.hidden)", { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await dismissOverlays(page, 2);
  if (!(await page.isVisible("#orders-view"))) failures.push("Après actualisation, la page en cours (Commandes) n'est pas conservée.");

  // ---- Accueil : les blocs attendus s'affichent, même sans aucune donnée
  await clickNav(page, '.nav-item[data-view="overview"]');
  await page.waitForSelector(".stats-insights", { timeout: 10_000 }).catch(() => undefined);
  const insightTitles = await page.$$eval(".stats-insights .insight-card h3", (titles) => titles.map((title) => title.textContent.trim()));
  for (const expected of ["Conversations qui aboutissent", "Articles les plus demandés", "Questions restées sans réponse"]) {
    if (!insightTitles.some((title) => title.startsWith(expected))) failures.push(`Accueil : le bloc « ${expected} » est absent.`);
  }
  if ((await page.locator(".kpi-card").count()) !== 4) failures.push("Accueil : les quatre chiffres clés ne s'affichent pas.");
  if (!(await page.isVisible("#todo-list"))) failures.push("Accueil : le bloc « À traiter » ne s'affiche pas.");
  // Tant que WhatsApp n'est pas relié, le guide de démarrage reste en tête de l'accueil (il disparaît une fois terminé).
  if ((await page.locator("#system-status.status-off").count()) && !(await page.isVisible("#onboarding-guide"))) failures.push("Accueil : le guide de démarrage n'apparaît pas alors que WhatsApp n'est pas relié.");
  await page.click('#stats-period [data-period="30"]');
  await page.waitForFunction(() => !document.querySelector("#stats-body.is-refreshing"), null, { timeout: 10_000 }).catch(() => undefined);
  if (!(await page.isVisible("#activity-chart svg"))) failures.push("Accueil : le graphique d'activité ne s'affiche pas sur 30 jours.");

  const status = await page.textContent("#system-status .system-status-text");
  if (!/WhatsApp/.test(status || "")) failures.push(`La pastille d'état n'indique pas l'état WhatsApp (« ${status} »).`);

  // ---- Recherche rapide (Ctrl + K) : on va à « Produits » au clavier
  await page.keyboard.press("Control+k");
  await page.waitForSelector("#command-palette:not(.hidden)", { timeout: 5_000 }).catch(() => failures.push("La recherche rapide ne s'ouvre pas avec Ctrl + K."));
  await page.keyboard.type("produits");
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  if (!(await page.isVisible("#products-view"))) failures.push("La recherche rapide n'ouvre pas la page « Produits ».");

  // ---- Produits : ajout puis suppression (panneau latéral, menu d'actions, fenêtre de confirmation)
  const productName = `Produit de test ${Date.now()}`;
  await page.click("#add-product");
  await page.waitForSelector("#product-drawer.open", { timeout: 5_000 }).catch(() => failures.push("Produits : le panneau d'ajout ne s'ouvre pas."));
  await page.fill("#product-name", productName);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".confirm-dialog", { timeout: 5_000 }).catch(() => failures.push("Produits : fermer une fiche en cours de saisie ne demande pas confirmation."));
  await page.click('.confirm-dialog [data-confirm="cancel"]'); // « Continuer la saisie »
  await page.fill("#product-description", "Créé par le test automatique, puis supprimé.");
  await page.fill("#product-price", "1 000 FCFA");
  await page.click("#save-product");
  await page.waitForSelector(`.product-card:has-text("${productName}")`, { timeout: 10_000 }).catch(() => failures.push("Produits : le produit ajouté n'apparaît pas dans le catalogue."));
  const card = page.locator(".product-card", { hasText: productName }).first();
  if (await card.count()) {
    await card.locator("[data-menu]").click();
    await card.locator("[data-delete-product]").click();
    await page.waitForSelector(".confirm-dialog", { timeout: 5_000 }).catch(() => failures.push("Produits : la suppression ne demande pas confirmation."));
    await page.click('.confirm-dialog [data-confirm="ok"]');
    await page.waitForFunction((name) => ![...document.querySelectorAll(".product-card")].some((element) => element.textContent.includes(name)), productName, { timeout: 10_000 })
      .catch(() => failures.push("Produits : le produit supprimé est encore affiché."));
  }

  // ---- Agent : modifications non enregistrées signalées, confirmation avant de quitter la page
  await clickNav(page, '.nav-item[data-view="agent"]');
  await page.waitForTimeout(800);
  const tabsOverflow = await page.$eval(".agent-tabs", (row) => row.scrollWidth - row.clientWidth);
  if (tabsOverflow > 1) failures.push(`Agent : les onglets ne tiennent pas sur une ligne (${tabsOverflow} px de trop).`);
  await page.click('.agent-tab[data-agent-tab="rules"]');
  if (!(await page.isVisible('[data-agent-pane="rules"]'))) failures.push("Agent : l'onglet « Règles avancées » ne s'ouvre pas.");
  await page.click('.agent-tab[data-agent-tab="identity"]');
  const originalName = await page.inputValue("#agent-name");
  await page.fill("#agent-name", `${originalName || "Assistant"} test`);
  if (!(await page.isVisible("#agent-dirty"))) failures.push("Agent : la barre « modifications non enregistrées » n'apparaît pas.");
  await page.click('.nav-item[data-view="overview"]');
  await page.waitForSelector(".confirm-dialog", { timeout: 5_000 }).catch(() => failures.push("Agent : quitter la page avec des modifications ne demande pas confirmation."));
  await page.click('.confirm-dialog [data-confirm="cancel"]'); // « Rester sur la page »
  await page.waitForTimeout(300);
  if (!(await page.isVisible("#agent-view"))) failures.push("Agent : « Rester sur la page » n'a pas gardé la page ouverte.");
  await page.click("#agent-discard");
  await page.waitForFunction(() => document.querySelector("#agent-dirty").classList.contains("hidden"), null, { timeout: 10_000 }).catch(() => failures.push("Agent : « Annuler » ne retire pas la barre d'enregistrement."));

  // ---- Rendez-vous : l'onglet des réglages
  await clickNav(page, '.nav-item[data-view="appointments"]');
  await page.click('[data-appointments-tab="settings"]');
  if (!(await page.isVisible("#agenda-form"))) failures.push("Rendez-vous : l'onglet « Réglages de l'agenda » ne s'ouvre pas.");

  // ---- Paramètres : les sections
  await clickNav(page, '.nav-item[data-view="settings"]');
  await page.click('[data-settings-tab="team"]');
  if (!(await page.isVisible('[data-settings-pane="team"]'))) failures.push("L'onglet « Équipe » des paramètres ne s'ouvre pas.");
  if (await page.isVisible('[data-settings-pane="responses"]')) failures.push("L'onglet « Réponses » reste affiché après avoir changé d'onglet.");

  // ---- Thème sombre puis retour au thème clair
  await page.click("#user-menu-trigger");
  await page.click('[data-theme-choice="dark"]');
  if ((await page.getAttribute("html", "data-theme")) !== "dark") failures.push("Le thème sombre ne s'applique pas.");
  await page.click('[data-theme-choice="light"]');
  if ((await page.getAttribute("html", "data-theme")) !== "light") failures.push("Le retour au thème clair ne s'applique pas.");
  await page.keyboard.press("Escape");

  // ---- Aide
  await clickNav(page, "#help-toggle");
  if (!(await page.isVisible("#help-panel"))) failures.push("Le panneau d'aide ne s'ouvre pas.");
  await page.click("#help-close");

  // ---- Déconnexion, puis nouvelle connexion dans le même onglet : elle repart d'une page neuve
  await clickNav(page, '.nav-item[data-view="orders"]');
  await page.click("#user-menu-trigger");
  await page.click("#logout-button");
  await page.waitForSelector(".confirm-dialog", { timeout: 5_000 }).catch(() => failures.push("Déconnexion : aucune confirmation n'est demandée."));
  await page.click('.confirm-dialog [data-confirm="ok"]');
  await page.waitForSelector("#login-form", { state: "visible", timeout: 10_000 }).catch(() => failures.push("Déconnexion : l'écran de connexion ne s'affiche pas."));
  if (await page.isVisible(".app-shell")) failures.push("Déconnexion : le tableau de bord reste affiché.");
  if (new URL(page.url()).hash) failures.push("Déconnexion : l'adresse garde la page de la session précédente.");
  await page.evaluate(() => { window.__samePage = true; });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-form button[type=submit]");
  await page.waitForFunction(() => !window.__samePage && document.querySelector(".app-shell:not(.hidden)") && document.querySelector("#todo-list") && !document.querySelector("#todo-list .skeleton"), null, { timeout: 20_000 })
    .catch(() => failures.push("Reconnexion : le tableau de bord ne repart pas d'une page neuve (des données du compte précédent pourraient rester affichées)."));
  if (!(await page.isVisible("#overview-view"))) failures.push("Reconnexion : on n'arrive pas sur l'accueil.");

  if (errors.length) failures.push(`Erreurs JavaScript sur ordinateur :\n  - ${errors.join("\n  - ")}`);
  await desktop.close();
}

async function landingJourney(browser, failures) {
  const visitor = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const landing = await visitor.newPage();
  const landingErrors = [];
  landing.on("pageerror", (error) => landingErrors.push(error.message));
  await landing.goto(`${BASE}/?accueil`, { waitUntil: "load" });
  await landing.waitForTimeout(800);
  if (!(await landing.isVisible(".hero h1"))) failures.push("Page d'accueil : le titre principal ne s'affiche pas.");
  if (!(await landing.isVisible("#tarifs .plan.popular"))) failures.push("Page d'accueil : les tarifs ne s'affichent pas.");
  if (!(await landing.$("html.has-motion [data-chat-loop].chat-live"))) failures.push("Page d'accueil : la conversation animée ne démarre pas.");
  await landing.click('label[for="m2"]');
  if (!(await landing.isVisible(".demo-tabs .tab-panel.p2"))) failures.push("Page d'accueil : l'onglet d'exemple « Salon » ne s'ouvre pas.");
  if (landingErrors.length) failures.push(`Erreurs JavaScript sur la page d'accueil :\n  - ${landingErrors.join("\n  - ")}`);
  await visitor.close();
}

async function mobileJourney(browser, failures) {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await skipTours(mobile);
  const phone = await mobile.newPage();
  const mobileErrors = watchErrors(phone);
  await login(phone);
  await dismissOverlays(phone);

  // Sur téléphone, l'export (action secondaire) laisse l'en-tête à « À traiter » et se retrouve dans les raccourcis.
  if (await phone.isVisible("#export-prospects")) failures.push("Mobile : le bouton d'export occupe encore l'en-tête de l'accueil.");
  if (!(await phone.isVisible('.quick-panel [data-quick="export"]'))) failures.push("Mobile : « Exporter les prospects » est absent des raccourcis.");

  await clickNav(phone, '.tab-item[data-view="inbox"]');
  await phone.waitForTimeout(400);
  if (!(await phone.isVisible("#inbox-view"))) failures.push("Mobile : l'onglet « Messages » n'ouvre pas les conversations.");

  await clickNav(phone, "#tab-more");
  await phone.waitForTimeout(500);
  if (!(await phone.isVisible("#sidebar.mobile-open"))) failures.push("Mobile : « Plus » n'ouvre pas le menu.");
  await phone.click('#sidebar .nav-item[data-view="products"]');
  await phone.waitForTimeout(600);
  if (!(await phone.isVisible("#products-view"))) failures.push("Mobile : le menu « Plus » n'ouvre pas la page choisie.");
  if (await phone.isVisible("#sidebar.mobile-open")) failures.push("Mobile : le menu « Plus » reste ouvert après avoir choisi une page.");

  // Aucune page ne doit dépasser la largeur de l'écran (sinon tout le site se met à défiler de côté).
  for (const view of Object.keys(VIEWS)) {
    await phone.evaluate((name) => document.querySelector(`#sidebar .nav-item[data-view="${name}"]`)?.click(), view);
    await phone.waitForTimeout(500);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) failures.push(`Mobile : la page « ${view} » dépasse la largeur de l'écran de ${overflow} px.`);
  }

  if (mobileErrors.length) failures.push(`Erreurs JavaScript sur mobile :\n  - ${mobileErrors.join("\n  - ")}`);
  await mobile.close();
}

async function run() {
  const browser = await chromium.launch();
  const failures = [];
  try {
    await desktopJourney(browser, failures);
    await landingJourney(browser, failures);
    await mobileJourney(browser, failures);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`✖ ${failures.length} problème(s) :\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`✔ Parcours du tableau de bord réussi (${Object.keys(VIEWS).length} pages, ordinateur et mobile).`);
}

run().catch((error) => {
  console.error("✖ Le parcours a échoué :", error);
  process.exit(1);
});
