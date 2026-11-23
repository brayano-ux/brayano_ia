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
    label: "votre page d'accueil",
    steps: [
      { selector: ".todo-card", title: "Ce qu'il y a à faire", text: "Clients qui attendent une réponse, paiements à vérifier, nouvelles commandes : tout ce qui demande une action est ici." },
      { selector: ".recent-card", title: "Dernières conversations", text: "Les échanges les plus récents avec vos clients. Cliquez sur l'un d'eux pour l'ouvrir." },
      { selector: ".kpi-grid", title: "Vos résultats", text: "Conversations, réponses de l'agent, commandes et ventes, comparés à la période précédente." },
    ],
  },
  whatsapp: {
    label: "la connexion WhatsApp",
    steps: [
      { selector: ".wa-number", title: "Le numéro de votre entreprise", text: "Celui que vos clients contactent déjà. Choisissez le pays, saisissez le numéro, puis enregistrez." },
      { selector: "#connect-wa", title: "Relier votre téléphone", text: "Le moyen le plus simple : affichez le QR code et scannez-le avec WhatsApp sur votre téléphone." },
      { selector: "#qr-container", title: "Votre code de connexion", text: "Le QR code (ou le code d'association) apparaît ici et se renouvelle automatiquement." },
    ],
  },
  agent: {
    label: "votre agent IA",
    steps: [
      { selector: ".agent-hero", title: "État de votre agent", text: "Activez ou mettez en pause ses réponses automatiques, et voyez ce qu'il reste à configurer." },
      { selector: ".agent-tabs", title: "Les réglages de l'agent", text: "Identité, connaissances, comportement, horaires… chaque onglet règle un aspect de son comportement." },
      { selector: "#agent-tester .agent-playground, #agent-test-open", title: "Testez-le avant vos clients", text: "Écrivez comme un client : vous voyez exactement ce que l'agent répondrait, sans rien envoyer." },
    ],
  },
  inbox: {
    label: "vos conversations",
    steps: [
      { selector: "#inbox-stage-filters", title: "Filtrer les conversations", text: "Retrouvez vite les clients à traiter, ceux qui ont commandé ou ceux à rappeler." },
      { selector: "#all-conversations", title: "Vos conversations", text: "Toutes les discussions WhatsApp de votre entreprise, mises à jour automatiquement." },
      { selector: "#conversation-detail", title: "Le détail d'une conversation", text: "Cliquez sur un client pour lire l'échange complet et reprendre la main si besoin." },
    ],
  },
  products: {
    label: "le catalogue produits",
    steps: [
      { selector: "#add-product", title: "Ajouter un produit", text: "Photo, nom, description et prix : votre agent s'en sert pour répondre et recommander le bon article." },
      { selector: "#products-list", title: "Votre catalogue", text: "Tous vos produits apparaissent ici, modifiables à tout moment." },
    ],
  },
  broadcasts: {
    label: "les messages groupés",
    steps: [
      { selector: "#broadcast-form", title: "Préparer un envoi", text: "Choisissez les clients concernés et rédigez votre annonce (promotion, nouveauté, horaires)." },
      { selector: ".broadcast-safety", title: "Protection de votre numéro", text: "Des règles automatiques limitent les envois pour éviter tout blocage de votre WhatsApp." },
    ],
  },
};

/**
 * Guide « ce qui a changé », pour les habitués de l'ancien tableau de bord : ils ont déjà vu le guide de l'accueil
 * (dans l'ancienne interface), on leur montre une fois les nouveaux repères. `when` réserve une étape à une mise
 * en page : le menu est à gauche sur ordinateur, en bas de l'écran sur téléphone.
 */
const REDESIGN_KEY = "nouveautes";
const REDESIGN_GUIDE = {
  label: "votre nouveau tableau de bord",
  steps: [
    { when: "desktop", selector: "#sidebar .nav", title: "Votre tableau de bord a changé", text: "Le menu est maintenant regroupé : vos ventes, votre agent, votre compte. « Vue d'ensemble » s'appelle désormais « Accueil »." },
    { when: "mobile", selector: ".tabbar", title: "Votre tableau de bord a changé", text: "Vos pages principales sont maintenant ici, en bas de l'écran. « Plus » ouvre toutes les autres." },
    { selector: ".todo-card", title: "Ce qu'il y a à faire", text: "Tout ce qui attend une action de votre part est réuni ici : clients à qui répondre, paiements à vérifier, commandes à confirmer." },
    { selector: "#command-trigger, .topbar-search", title: "Recherche rapide", text: "Retrouvez un client, une page ou une action en tapant quelques lettres." },
  ],
};

/** Premier élément réellement affiché parmi ceux que désigne le sélecteur (un élément masqué ne peut pas être montré). */
function visibleTarget(selector) {
  return Array.from(document.querySelectorAll(selector)).find((element) => {
    // getClientRects plutôt que offsetParent : ce dernier est nul pour un élément en position fixe (barre d'onglets
    // du téléphone, barre du haut), qui est pourtant bien à l'écran.
    if (!element.getClientRects().length || getComputedStyle(element).visibility === "hidden") return false;
    const box = element.getBoundingClientRect();
    return box.height > 0 && box.right > 0 && box.left < window.innerWidth;
  }) || null;
}

let active = null; // { steps, index, elements, onDone }
const pending = new Set(); // vues dont le guide est programmé (setTimeout) mais pas encore lancé

function seenKey(view) {
  return `${SEEN_PREFIX}${view}`;
}

function markSeen(view) {
  try {
    localStorage.setItem(seenKey(view), "1");
    // Qui découvre l'accueil avec son guide connaît déjà la nouvelle interface : pas de « ce qui a changé » pour lui.
    if (view === "overview") localStorage.setItem(seenKey(REDESIGN_KEY), "1");
  } catch { /* stockage indisponible : le guide pourra se rejouer, ce n'est pas grave */ }
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
        <button type="button" class="btn btn-sm btn-ghost tour-skip">Passer le guide</button>
        <button type="button" class="btn btn-sm btn-primary tour-next">Suivant</button>
      </div>
    </div>
    <div class="tour-bravo hidden">
      <div class="tour-bravo-card">
        <span class="icon-tile icon-tile-lg success" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><use href="#i-check-circle"></use></svg></span>
        <h3>Bravo !</h3>
        <p></p>
        <button type="button" class="btn btn-primary tour-bravo-close">Continuer</button>
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
  // Sous la zone s'il y a la place, sinon au-dessus ; dans tous les cas l'explication reste entièrement à l'écran
  // (quitte à recouvrir le bas d'une zone plus haute que la fenêtre).
  const preferred = spaceBelow > th + margin * 2 ? rect.bottom + margin : rect.top - th - margin;
  const top = Math.min(Math.max(margin, preferred), window.innerHeight - th - margin);
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
  const target = visibleTarget(step.selector);
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
    // Le texte d'abord : la bulle est placée d'après sa hauteur réelle (sinon, au-dessus d'un élément du bas de
    // l'écran, elle le recouvrait en s'agrandissant).
    els.stepCount.textContent = `Étape ${index + 1} sur ${steps.length}`;
    els.title.textContent = step.title;
    els.text.textContent = step.text;
    els.next.textContent = index + 1 === steps.length ? "Terminer" : "Suivant";
    positionTooltip(els, rect);
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
  start(view, view, VIEW_TOURS[view]);
}

/** `key` : ce qui est mémorisé comme « déjà vu » ; `view` : la page sur laquelle le guide a un sens. */
function start(key, view, config) {
  if (!config || active || blockingModalOpen()) return;
  markSeen(key);
  const layout = window.matchMedia("(max-width: 1023px)").matches ? "mobile" : "desktop";
  const steps = config.steps.filter((step) => !step.when || step.when === layout);
  const els = buildOverlay();
  active = { view, steps, label: config.label, els, index: 0 };
  els.next.onclick = next;
  els.skip.onclick = skip;
  document.addEventListener("keydown", onKeydown);
  showStep(0);
}

/** Appelé à chaque changement d'onglet : lance le guide une seule fois par appareil. */
export function maybeStartViewTour(view) {
  // Un guide encore ouvert sur un autre onglet n'a plus de sens ici : ses repères pointeraient sur des éléments
  // qui ne sont plus affichés. On le ferme plutôt que de laisser un cadre orphelin sur la nouvelle page.
  if (active && active.view !== view) skip();
  // Habitué de l'ancien tableau de bord (il a déjà vu le guide de l'accueil) : une fois, ce qui a changé.
  if (view === "overview" && hasSeen("overview") && !hasSeen(REDESIGN_KEY) && !active && !pending.has(REDESIGN_KEY)) {
    pending.add(REDESIGN_KEY);
    window.setTimeout(() => {
      pending.delete(REDESIGN_KEY);
      // L'utilisateur est peut-être déjà parti sur une autre page : le guide attendra son retour sur l'accueil.
      if (document.body.dataset.currentView === "overview") start(REDESIGN_KEY, "overview", REDESIGN_GUIDE);
    }, 900);
    return;
  }
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
