/**
 * Refait les captures du tableau de bord montrées sur la page d'accueil du site (assets/screens/).
 *
 * Ce sont de vraies captures : le vrai tableau de bord, rempli avec les données de démonstration
 * (apps/backend/src/dev/seed-demo.ts). Seul l'état « WhatsApp connecté » est simulé, car un poste de
 * développement n'a pas de téléphone relié.
 *
 * Avant de lancer : serveur local démarré sur une base fraîchement remplie par seed-demo.ts, et site servi
 * sur le port 4173 (voir README.md). Puis :
 *
 *   node capture-landing.cjs
 *
 * Variables : DASHBOARD_URL, API_URL, CAPTURE_TZ (fuseau du navigateur : les données de démonstration sont
 * datées « à l'instant », choisir un fuseau où il fait jour donne des heures naturelles à l'écran).
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const sharp = require("../../backend/node_modules/sharp");

const DASHBOARD = process.env.DASHBOARD_URL || "http://127.0.0.1:4173";
const API = process.env.API_URL || "http://127.0.0.1:3000";
const ACCOUNT = { email: "awa@brayano.test", password: "DemoPassword123" };
const OUT = path.join(__dirname, "..", "assets", "screens");
// 1366 px : la largeur d'ordinateur portable la plus courante ; la boîte de réception y montre ses trois volets.
const VIEWPORT = { width: 1366, height: 863 };
const SIZES = [[1200, 758, 84], [2400, 1516, 76]];
const VIEWS_WITH_TOUR = ["overview", "whatsapp", "agent", "inbox", "products", "broadcasts", "orders", "appointments", "billing", "settings"];
const ANNOUNCEMENT = "Bonjour ! La nouvelle collection de robes wax est arrivée en boutique. Livraison offerte à Douala jusqu'à samedi.";

async function save(page, name) {
  const capture = await page.screenshot({ type: "png" });
  for (const [width, height, quality] of SIZES) {
    const file = path.join(OUT, `${name}-${width}.webp`);
    await sharp(capture).resize(width, height, { fit: "cover", position: "top" }).webp({ quality, effort: 6 }).toFile(file);
    console.log(`${name}-${width}.webp — ${Math.round(fs.statSync(file).size / 1024)} Ko`);
  }
}

const show = async (page, view) => {
  await page.locator(`.nav-item[data-view="${view}"]`).click();
  await page.waitForTimeout(900);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: "fr-FR", timezoneId: process.env.CAPTURE_TZ || "Africa/Douala" });
  const login = await context.request.post(`${API}/login`, { data: ACCOUNT });
  if (!login.ok()) throw new Error(`Connexion refusée (${login.status()}) : la base contient-elle les données de démonstration ?`);
  const session = await login.json();
  // Session déjà ouverte, guides pas à pas déjà vus.
  await context.addInitScript(({ session, views }) => {
    try {
      localStorage.setItem("brayano_session", JSON.stringify({ email: session.user.email, token: session.token, organizationId: session.organizationId, role: "ADMIN" }));
      for (const view of views) localStorage.setItem(`brayano_tour_seen:${view}`, "1");
    } catch { /* cadre tiers (carte) : pas de stockage */ }
  }, { session, views: VIEWS_WITH_TOUR });

  const page = await context.newPage();
  // Compte dont le numéro est relié : même état pour la page WhatsApp et pour le guide de démarrage.
  await page.route("**/whatsapp/status", (route) => route.fulfill({ json: { status: "CONNECTED", declaredNumber: "237690112233", declaredDisplay: "+237 6 90 11 22 33", connectedNumber: "237690112233", numberMatches: true } }));
  await page.route("**/organizations/*/onboarding", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.onboarding) body.onboarding.whatsappConnected = true;
    await route.fulfill({ response, json: body });
  });

  // 1. Accueil
  await page.goto(`${DASHBOARD}/app/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".kpi-card", { timeout: 20000 });
  await page.waitForTimeout(900);
  await save(page, "accueil");

  // 2. Conversations : un client qui a commandé, avec sa fiche à droite
  await show(page, "inbox");
  await page.locator("#all-conversations .conversation-row").first().click();
  await page.waitForSelector("#detail-thread .msg", { timeout: 20000 });
  await page.waitForTimeout(1200);
  await save(page, "conversations");

  // 3. Agent IA : ce que l'agent sait de l'entreprise, le testeur à côté
  await show(page, "agent");
  await page.locator('.agent-tab[data-agent-tab="knowledge"]').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('[data-agent-pane="knowledge"] .card')].find((element) => /Ce que l.agent sait/.test(element.textContent));
    // Une fois la page défilée, la rangée d'onglets reste collée sous la barre du haut : la fiche se place juste dessous.
    const tabs = document.querySelector(".agent-tabs");
    const stuckBottom = parseFloat(getComputedStyle(tabs).top) + tabs.getBoundingClientRect().height;
    if (card) window.scrollBy(0, card.getBoundingClientRect().top - stuckBottom - 20);
  });
  await page.waitForTimeout(500);
  await save(page, "agent");

  // 4. Messages groupés : une annonce prête à partir
  await show(page, "broadcasts");
  await page.locator("#broadcast-form label", { hasText: "Intéressés" }).first().click();
  await page.locator("#broadcast-form textarea").first().fill(ANNOUNCEMENT);
  await page.waitForTimeout(900);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.waitForTimeout(300);
  await save(page, "messages-groupes");

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
