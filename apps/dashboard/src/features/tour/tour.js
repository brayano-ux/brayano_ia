/**
 * Guide pas à pas, à la manière des tutoriels de jeu vidéo : à la première visite d'un onglet, un
 * curseur simulé se déplace vers chaque élément important, l'« appuie » (animation seulement — aucun
 * clic réel n'est déclenché) et explique à quoi il sert. Une fois le guide terminé, un message de
 * félicitations s'affiche. Chaque guide n'est montré qu'une fois par navigateur (mémorisé dans le
 * stockage local de l'appareil).
 */

const SEEN_PREFIX = "brayano_tour_seen:";
const STEP_TRANSITION_MS = 550;

/** Onglets couverts, dans l'ordre naturel de découverte. Un onglet absent de cette liste n'a pas de guide. */
const VIEW_TOURS = {
  overview: {
    label: "la vue d'ensemble",
    steps: [
      { selector: ".metrics", title: "Vos chiffres du jour", text: "Conversations actives, clients à traiter et statut de votre WhatsApp, en temps réel." },
      { selector: "#recent-conversations", title: "Conversations récentes", text: "Les derniers échanges avec vos clients apparaissent ici dès qu'ils arrivent." },
      { selector: ".quick-panel", title: "Actions rapides", text: "Connectez WhatsApp, personnalisez votre agent ou ouvrez la boîte de réception en un clic." },
    ],
  },
  whatsapp: {
    label: "la connexion WhatsApp",
    steps: [
      { selector: ".wa-number", title: "Le numéro de votre entreprise", text: "Celui que vos clients contactent déjà. Choisissez le pays, saisissez le numéro, puis enregistrez." },
      { selector: "#connect-wa", title: "Connexion par QR code", text: "Le moyen le plus simple : scannez ce code avec WhatsApp sur votre téléphone." },
      { selector: "#qr-container", title: "Votre code de connexion", text: "Le QR code (ou le code d'association) apparaît ici et se renouvelle automatiquement." },
    ],
  },
  agent: {
    label: "votre agent IA",
    steps: [
      { selector: ".agent-hero", title: "État de votre agent", text: "Activez ou mettez en pause ses réponses automatiques, et suivez sa configuration en un coup d'œil." },
      { selector: ".agent-tabs", title: "Les réglages de l'agent", text: "Identité, connaissances, comportement, horaires… chaque onglet règle un aspect de son comportement." },
      { selector: "#config-assistant", title: "L'assistant de configuration", text: "Collez un texte, un site web ou un PDF : l'IA en extrait les informations de votre activité à votre place." },
    ],
  },
  inbox: {
    label: "la boîte de réception",
    steps: [
      { selector: "#inbox-stage-filters", title: "Filtrer par étiquette", text: "Retrouvez vite les nouveaux clients, ceux qui ont commandé, ou ceux à rappeler." },
      { selector: "#all-conversations", title: "Vos conversations", text: "Toutes les discussions WhatsApp de votre entreprise, mises à jour automatiquement." },
      { selector: "#conversation-detail", title: "Le détail d'une conversation", text: "Cliquez sur un client pour lire l'échange complet et reprendre la main si besoin." },
    ],
  },
  products: {
    label: "le catalogue produits",
    steps: [
      { selector: "#product-form", title: "Ajouter un produit", text: "Photo, nom, description et prix : votre agent s'en sert pour répondre et recommander le bon article." },
      { selector: "#products-list", title: "Votre catalogue", text: "Tous vos produits ajoutés apparaissent ici, modifiables à tout moment." },
    ],
  },
  broadcasts: {
    label: "les messages groupés",
    steps: [
      { selector: ".broadcast-safety", title: "Protection de votre numéro", text: "Des règles automatiques limitent les envois pour éviter tout blocage de votre WhatsApp." },
      { selector: "#broadcast-form", title: "Préparer un envoi", text: "Choisissez les clients concernés et rédigez votre annonce (promotion, nouveauté, horaires)." },
    ],
  },
};

let active = null; // { steps, index, elements, onDone }
const pending = new Set(); // vues dont le guide est programmé (setTimeout) mais pas encore lancé

function seenKey(view) {
  return `${SEEN_PREFIX}${view}`;
}

function markSeen(view) {
  try { localStorage.setItem(seenKey(view), "1"); } catch { /* stockage indisponible : le guide pourra se rejouer, ce n'est pas grave */ }
}

function hasSeen(view) {
  try { return localStorage.getItem(seenKey(view)) === "1"; } catch { return true; }
}

function buildOverlay() {
  const root = document.createElement("div");
  root.className = "tour-root";
  root.innerHTML = `
    <div class="tour-dim"></div>
    <div class="tour-spotlight" aria-hidden="true"></div>
    <div class="tour-cursor" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 2l16 7.5-6.6 2.1L10 19 4 2z"/></svg></div>
    <div class="tour-tooltip" role="dialog" aria-live="polite">
      <p class="tour-step-count"></p>
      <h3 class="tour-title"></h3>
      <p class="tour-text"></p>
      <div class="tour-actions">
        <button type="button" class="text-button tour-skip">Passer le guide</button>
        <button type="button" class="primary tour-next">Suivant</button>
      </div>
    </div>
    <div class="tour-bravo hidden">
      <div class="tour-bravo-card">
        <span class="tour-bravo-emoji" aria-hidden="true">🎉</span>
        <h3>Bravo !</h3>
        <p></p>
        <button type="button" class="primary tour-bravo-close">Continuer</button>
      </div>
    </div>`;
  document.body.append(root);
  return {
    root,
    dim: root.querySelector(".tour-dim"),
    spotlight: root.querySelector(".tour-spotlight"),
    cursor: root.querySelector(".tour-cursor"),
    tooltip: root.querySelector(".tour-tooltip"),
    stepCount: root.querySelector(".tour-step-count"),
    title: root.querySelector(".tour-title"),
    text: root.querySelector(".tour-text"),
    next: root.querySelector(".tour-next"),
    skip: root.querySelector(".tour-skip"),
    bravo: root.querySelector(".tour-bravo"),
    bravoText: root.querySelector(".tour-bravo p"),
    bravoClose: root.querySelector(".tour-bravo-close"),
  };
}

function positionCursorAndSpotlight(els, rect) {
  const padding = 8;
  els.spotlight.style.left = `${rect.left - padding}px`;
  els.spotlight.style.top = `${rect.top - padding}px`;
  els.spotlight.style.width = `${rect.width + padding * 2}px`;
  els.spotlight.style.height = `${rect.height + padding * 2}px`;
  els.cursor.style.left = `${rect.left + rect.width / 2}px`;
  els.cursor.style.top = `${rect.top + rect.height / 2}px`;
}

function positionTooltip(els, rect) {
  const tooltip = els.tooltip;
  tooltip.style.visibility = "hidden";
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  const { width: tw, height: th } = tooltip.getBoundingClientRect();
  const margin = 16;
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow > th + margin * 2 ? rect.bottom + margin : Math.max(margin, rect.top - th - margin);
  let left = rect.left + rect.width / 2 - tw / 2;
  left = Math.min(Math.max(left, margin), window.innerWidth - tw - margin);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.visibility = "visible";
}

/** Attend que le défilement (lancé en douceur) soit terminé avant de lire la position réelle de l'élément. */
function waitForScrollToSettle(callback) {
  let lastTop = null;
  let stableFrames = 0;
  const check = () => {
    const top = window.scrollY;
    if (top === lastTop) {
      stableFrames += 1;
      if (stableFrames >= 3) { callback(); return; }
    } else {
      stableFrames = 0;
      lastTop = top;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

function showStep(index) {
  const { steps, els } = active;
  const step = steps[index];
  const target = document.querySelector(step.selector);
  if (!target) {
    // Élément absent (pas encore chargé, ou invisible pour ce compte) : on passe l'étape sans bloquer le guide.
    if (index + 1 < steps.length) showStep(index + 1);
    else finish();
    return;
  }

  active.index = index;
  els.tooltip.classList.remove("visible");
  target.scrollIntoView({ behavior: "smooth", block: "center" });

  waitForScrollToSettle(() => {
    if (!active || active.index !== index) return; // l'utilisateur a déjà changé d'étape pendant le défilement
    const rect = target.getBoundingClientRect();
    positionCursorAndSpotlight(els, rect);
    els.cursor.classList.remove("clicking");
    window.setTimeout(() => els.cursor.classList.add("clicking"), STEP_TRANSITION_MS);
    positionTooltip(els, rect);
    els.stepCount.textContent = `Étape ${index + 1} sur ${steps.length}`;
    els.title.textContent = step.title;
    els.text.textContent = step.text;
    els.next.textContent = index + 1 === steps.length ? "Terminer" : "Suivant";
    els.tooltip.classList.add("visible");
  });
}

function finish() {
  const { els, onDone, label } = active;
  els.tooltip.classList.remove("visible");
  els.cursor.classList.remove("clicking");
  els.dim.classList.add("hidden");
  els.spotlight.classList.add("hidden");
  els.cursor.classList.add("hidden");
  els.bravoText.textContent = `Vous savez maintenant utiliser ${label}.`;
  els.bravo.classList.remove("hidden");
  const close = () => {
    cleanup();
    onDone?.();
  };
  els.bravoClose.onclick = close;
}

function cleanup() {
  active?.els.root.remove();
  document.removeEventListener("keydown", onKeydown);
  active = null;
}

function onKeydown(event) {
  if (event.key === "Escape") skip();
}

function skip() {
  if (!active) return;
  cleanup();
}

function next() {
  if (!active) return;
  const { steps, index } = active;
  if (index + 1 < steps.length) showStep(index + 1);
  else finish();
}

/** Lance le guide d'un onglet manuellement (utilisable depuis l'aide, même si déjà vu). */
function blockingModalOpen() {
  // Le guide ne doit jamais s'afficher par-dessus une fenêtre qui attend une décision de l'utilisateur
  // (guide de démarrage à la première connexion, fenêtres de saisie…).
  return Boolean(document.querySelector(".persona-overlay:not(.hidden), .modal:not(.hidden)"));
}

export function runTour(view) {
  const config = VIEW_TOURS[view];
  if (!config || active || blockingModalOpen()) return;
  markSeen(view);
  const els = buildOverlay();
  active = { view, steps: config.steps, label: config.label, els, index: 0 };
  els.next.onclick = next;
  els.skip.onclick = skip;
  document.addEventListener("keydown", onKeydown);
  showStep(0);
}

/** Appelé à chaque changement d'onglet : lance le guide une seule fois par appareil. */
export function maybeStartViewTour(view) {
  if (!VIEW_TOURS[view] || hasSeen(view) || active || pending.has(view)) return;
  pending.add(view);
  window.setTimeout(() => {
    pending.delete(view);
    runTour(view);
  }, 400);
}

/** Onglets pour lesquels un guide existe, utile pour proposer « revoir le guide » depuis l'aide. */
export function toursAvailable() {
  return Object.keys(VIEW_TOURS);
}
