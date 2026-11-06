/**
 * Parcours de fumée du tableau de bord, exécuté par la CI (voir .github/workflows/ci.yml) :
 *   1. l'écran de connexion s'affiche ;
 *   2. la connexion avec le compte administrateur configuré (DEFAULT_ADMIN_EMAIL / PASSWORD) aboutit ;
 *   3. chaque onglet s'ouvre sans erreur JavaScript ;
 *   4. la pastille d'en-tête reflète l'état WhatsApp ; les onglets des paramètres fonctionnent ;
 *   5. sur mobile, la barre d'onglets et le menu « Plus » répondent.
 *
 * Variables : DASHBOARD_URL (défaut http://127.0.0.1:4173), E2E_EMAIL, E2E_PASSWORD.
 */
const { chromium } = require("playwright");

const BASE = process.env.DASHBOARD_URL || "http://127.0.0.1:4173";
const EMAIL = process.env.E2E_EMAIL || "demo@brayano.test";
const PASSWORD = process.env.E2E_PASSWORD || "DemoPassword123";
const VIEWS = ["overview", "inbox", "agent", "products", "appointments", "orders", "broadcasts", "billing", "settings", "whatsapp"];

function assert(condition, message) {
  if (!condition) throw new Error(`Échec : ${message}`);
}

/** Les guides pas à pas (un par onglet, à la première visite) couvrent la page : on les marque « déjà vus » avant de charger. */
const TOUR_VIEWS = ["overview", "whatsapp", "agent", "inbox", "products", "broadcasts"];
async function skipTours(context) {
  await context.addInitScript((views) => {
    try { for (const view of views) localStorage.setItem(`brayano_tour_seen:${view}`, "1"); } catch { /* stockage indisponible */ }
  }, TOUR_VIEWS);
}

async function login(page) {
  await page.goto(`${BASE}/app/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-email", { timeout: 20_000 });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-form button[type=submit]");
  await page.waitForSelector(".app-shell:not(.hidden)", { timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector("#company-greeting")?.textContent?.trim() && document.querySelector("#company-greeting").textContent.trim() !== "Bienvenue", null, { timeout: 20_000 });
}

async function dismissOverlays(page) {
  for (const selector of ["#persona-skip", ".tour-skip"]) {
    const element = page.locator(selector).first();
    if (await element.count() && await element.isVisible().catch(() => false)) {
      await element.click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

async function run() {
  const browser = await chromium.launch();
  const failures = [];
  try {
    // ---- Ordinateur
    const desktop = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await skipTours(desktop);
    const page = await desktop.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    // Les ressources externes (polices, pixel) peuvent être bloquées par le réseau de la CI : seules les vraies erreurs JavaScript comptent.
    page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|favicon|facebook|fonts\.g/i.test(message.text())) errors.push(`console: ${message.text()}`); });

    await login(page);
    await dismissOverlays(page);

    for (const view of VIEWS) {
      await page.click(`.nav-item[data-view="${view}"]`);
      await page.waitForTimeout(600);
      await dismissOverlays(page);
      const visible = await page.isVisible(`#${view}-view`);
      if (!visible) failures.push(`La vue « ${view} » ne s'affiche pas.`);
    }

    const status = await page.textContent("#system-status .system-status-text");
    if (!/WhatsApp/.test(status || "")) failures.push(`La pastille d'état n'indique pas l'état WhatsApp (« ${status} »).`);

    await page.click('.nav-item[data-view="settings"]');
    await page.click('[data-settings-tab="team"]');
    if (!(await page.isVisible('[data-settings-pane="team"]'))) failures.push("L'onglet « Équipe » des paramètres ne s'ouvre pas.");
    if (await page.isVisible('[data-settings-pane="responses"]')) failures.push("L'onglet « Réponses » reste affiché après avoir changé d'onglet.");

    await page.click("#help-toggle");
    if (!(await page.isVisible("#help-panel"))) failures.push("Le panneau d'aide ne s'ouvre pas.");
    await page.click("#help-close");

    if (errors.length) failures.push(`Erreurs JavaScript sur ordinateur :\n  - ${errors.join("\n  - ")}`);
    await desktop.close();

    // ---- Mobile
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await skipTours(mobile);
    const phone = await mobile.newPage();
    const mobileErrors = [];
    phone.on("pageerror", (error) => mobileErrors.push(error.message));
    await login(phone);
    await dismissOverlays(phone);
    await phone.click('.tab-item[data-view="inbox"]');
    await phone.waitForTimeout(400);
    if (!(await phone.isVisible("#inbox-view"))) failures.push("Mobile : l'onglet « Messages » n'ouvre pas la boîte de réception.");
    await phone.click("#tab-more");
    await phone.waitForTimeout(400);
    if (!(await phone.isVisible("#sidebar.mobile-open"))) failures.push("Mobile : « Plus » n'ouvre pas le menu.");
    if (mobileErrors.length) failures.push(`Erreurs JavaScript sur mobile :\n  - ${mobileErrors.join("\n  - ")}`);
    await mobile.close();
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`✖ ${failures.length} problème(s) :\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`✔ Parcours du tableau de bord réussi (${VIEWS.length} vues, ordinateur et mobile).`);
}

run().catch((error) => {
  console.error("✖ Le parcours a échoué :", error);
  process.exit(1);
});
