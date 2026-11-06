import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { isAgentRole } from "../navigation/roles.js";

/**
 * Guide de démarrage affiché une seule fois, à la première connexion du propriétaire, en trois
 * étapes : personnalité de l'agent (domaine, rôle, ton choisis parmi des cartes), informations sur
 * l'activité (saisies à la main ou structurées par l'IA à partir d'un texte collé), puis invitation
 * à connecter WhatsApp. Chaque étape peut être passée ; rien n'est perdu, le reste se termine
 * ensuite depuis le panneau de progression ou « Agent IA ».
 */

const DOMAINS = [
  { key: "boutique", emoji: "🛍️", label: "Boutique / Commerce", blurb: "Vente de produits à partir d'un catalogue.", context: "L'entreprise est une boutique : elle vend des produits à ses clients à partir d'un catalogue. Donne toujours les prix exacts du catalogue, sans jamais en inventer." },
  { key: "salon", emoji: "💇", label: "Salon de coiffure / beauté", blurb: "Prestations, tarifs et prise de rendez-vous.", context: "L'entreprise est un salon de coiffure et de beauté : elle propose des prestations à ses clients et aide à choisir un créneau parmi les disponibilités indiquées. N'invente jamais un tarif, une durée ou une disponibilité." },
  { key: "clinique", emoji: "🏥", label: "Clinique / Santé", blurb: "Informations pratiques et rendez-vous, sans conseil médical.", context: "L'entreprise est une clinique : donne uniquement les informations pratiques (horaires, adresse, services listés) et aide à prendre rendez-vous. Ne donne jamais de conseil ni de diagnostic médical : en cas d'urgence ou de question de santé, invite le patient à appeler la clinique ou les urgences." },
  { key: "restaurant", emoji: "🍽️", label: "Restaurant / Traiteur", blurb: "Menu, prix, réservations et commandes.", context: "L'entreprise est un restaurant ou un traiteur : elle présente son menu et ses prix, et prend les réservations ou les commandes. N'invente jamais un plat ni un prix." },
  { key: "services", emoji: "🧰", label: "Entreprise de services", blurb: "Explique l'offre et recueille le besoin du client.", context: "L'entreprise propose des services : explique l'offre d'après les informations de l'entreprise et recueille le besoin du client. N'annonce jamais un prix ou un délai qui n'est pas indiqué." },
];

const ROLES = [
  { key: "closer", emoji: "🎯", label: "Closer / Vendeur", blurb: "Pousse à la conclusion : avantages, objections, action immédiate.", prompt: "Tu es un closer. Ton objectif est de convaincre le client de passer à l'action maintenant (commander, réserver ou payer). Mets en avant les bénéfices à partir des informations de l'entreprise, réponds aux objections avec les arguments disponibles, et propose toujours une suite concrète. N'invente jamais une remise, un stock ou un délai qui n'est pas indiqué. Si le client hésite, demande ce qui le retient et propose une alternative." },
  { key: "support", emoji: "🎧", label: "Support client", blurb: "Aide et résout les problèmes, sans chercher à vendre.", prompt: "Tu es un agent de support client. Ton objectif est de résoudre la question ou le problème du client le plus vite et le plus clairement possible, en t'appuyant uniquement sur les informations de l'entreprise. Si tu ne sais pas, dis-le honnêtement et passe la main à l'équipe plutôt que de deviner. Ne pousse jamais à la vente : ton rôle est d'aider, pas de vendre." },
  { key: "commercial", emoji: "🤝", label: "Commercial / Conseiller", blurb: "Comprend le besoin, informe, puis qualifie le prospect.", prompt: "Tu es un commercial. Ton objectif est d'informer le prospect, de comprendre son besoin par quelques questions, puis de recueillir ses coordonnées et son besoin pour que l'équipe le recontacte. N'invente jamais un prix, une caractéristique ou un délai qui n'est pas indiqué." },
  { key: "accueil", emoji: "💁", label: "Accueil / Rendez-vous", blurb: "Oriente le client et aide à réserver un créneau.", prompt: "Tu es l'assistant d'accueil. Ton objectif est d'orienter le client (horaires, adresse, services proposés) et de l'aider à réserver un créneau parmi les disponibilités indiquées. Confirme toujours clairement la date et l'heure retenues. N'invente jamais une disponibilité ni un service qui n'est pas indiqué." },
  { key: "fidelisation", emoji: "🔁", label: "Relance & fidélisation", blurb: "Relance poliment les clients silencieux.", prompt: "Tu es chargé de la relation avec les clients déjà existants. Ton objectif est de relancer poliment les clients qui n'ont pas répondu, de les informer des nouveautés ou promotions indiquées, et de reprendre la conversation là où elle s'est arrêtée. Ne sois jamais insistant : une relance polie suffit, puis tu laisses la main si le client ne répond pas." },
];

const TONES = [
  { key: "professionnel", emoji: "🎩", label: "Professionnel", blurb: "Soigné et vouvoyant, sans familiarité.", suffix: "Adopte un ton professionnel et soigné : vouvoie le client, des phrases complètes et correctement écrites, sans familiarité ni emoji excessif." },
  { key: "amical", emoji: "😊", label: "Amical & chaleureux", blurb: "Accueillant et bienveillant, quelques emojis.", suffix: "Adopte un ton amical et chaleureux : sois accueillant et bienveillant, tu peux utiliser quelques emojis avec modération, tout en restant clair." },
  { key: "direct", emoji: "⚡", label: "Direct & efficace", blurb: "Des phrases courtes, droit au but.", suffix: "Adopte un ton direct et efficace : des phrases courtes, droit au but, sans formules de politesse superflues." },
  { key: "decontracte", emoji: "😎", label: "Décontracté", blurb: "Naturel, comme une discussion WhatsApp.", suffix: "Adopte un ton décontracté et naturel, comme une conversation WhatsApp entre connaissances, tout en restant respectueux ; tu peux tutoyer si le client tutoie en premier." },
];

const STEPS = ["persona", "business", "whatsapp"];
const MIN_SOURCE_LENGTH = 20;

let selectedDomain = null;
let selectedRole = null;
let selectedTone = null;
let currentStep = "persona";
let businessInfoDraft = "";
let goToWhatsApp = () => {};

function cardMarkup(item, selectedKey) {
  const selected = item.key === selectedKey;
  return `
    <button type="button" class="persona-option${selected ? " selected" : ""}" data-key="${escapeHtml(item.key)}" role="radio" aria-checked="${selected}">
      <span class="persona-emoji" aria-hidden="true">${item.emoji}</span>
      <strong>${escapeHtml(item.label)}</strong>
      <small>${escapeHtml(item.blurb)}</small>
    </button>`;
}

function renderPersonaCards() {
  $("#persona-domains").innerHTML = DOMAINS.map((domain) => cardMarkup(domain, selectedDomain?.key)).join("");
  $("#persona-roles").innerHTML = ROLES.map((role) => cardMarkup(role, selectedRole?.key)).join("");
  $("#persona-tones").innerHTML = TONES.map((tone) => cardMarkup(tone, selectedTone?.key)).join("");
}

const STEP_COPY = {
  persona: {
    title: "Donnez une personnalité à votre agent",
    subtitle: "Choisissez son domaine, son rôle et son ton : il s'exprimera ainsi dès maintenant avec vos clients. Vous pourrez toujours l'ajuster plus tard dans « Agent IA ».",
    next: "Suivant",
  },
  business: {
    title: "Parlez-lui de votre activité",
    subtitle: "Plus votre agent en sait sur votre activité, mieux il répond à vos clients.",
    next: "Suivant",
  },
  whatsapp: {
    title: "Votre agent est configuré",
    subtitle: "Il ne reste plus qu'une étape avant qu'il commence à répondre à vos clients.",
    next: "Connecter WhatsApp maintenant",
  },
};

function renderStep() {
  const index = STEPS.indexOf(currentStep);
  $("#persona-step-indicator").textContent = `Étape ${index + 1} sur ${STEPS.length}`;
  // La dernière étape porte déjà son propre titre dans « .persona-final » : l'en-tête générique
  // ne doit pas répéter le même message juste au-dessus.
  $(".persona-head").classList.toggle("hidden", currentStep === "whatsapp");
  const copy = STEP_COPY[currentStep];
  if (currentStep !== "whatsapp") {
    $("#persona-title").textContent = copy.title;
    $("#persona-subtitle").textContent = copy.subtitle;
  }
  STEPS.forEach((step) => $(`#persona-step-${step}`).classList.toggle("hidden", step !== currentStep));

  const next = $("#persona-next");
  next.textContent = copy.next;
  next.disabled = currentStep === "persona" && !(selectedDomain && selectedRole && selectedTone);

  const skipButton = $("#persona-skip");
  skipButton.textContent = currentStep === "whatsapp" ? "Plus tard, depuis le tableau de bord" : "Configurer plus tard";
}

function close() {
  $("#persona-modal").classList.add("hidden");
}

function buildSystemPrompt() {
  return `${selectedDomain.context} ${selectedRole.prompt} ${selectedTone.suffix}`;
}

async function savePersonaAndBusiness() {
  await api(`/organizations/${getState().organizationId}/ai-settings`, {
    method: "PUT",
    body: JSON.stringify({
      agentDomain: selectedDomain.label,
      agentRole: selectedRole.label,
      agentTone: selectedTone.label,
      systemPrompt: buildSystemPrompt(),
      ...(businessInfoDraft.trim() ? { businessInfo: businessInfoDraft.trim() } : {}),
    }),
  });
}

async function analyzeBusinessText() {
  const text = $("#persona-business-text").value.trim();
  if (text.length < MIN_SOURCE_LENGTH) {
    showToast(`Collez un texte plus long (${MIN_SOURCE_LENGTH} caractères minimum).`, "error");
    return;
  }
  const button = $("#persona-business-analyze");
  const status = $("#persona-business-status");
  const missing = $("#persona-business-missing");
  button.disabled = true;
  status.textContent = "Analyse en cours… (jusqu'à 30 secondes)";
  missing.classList.add("hidden");
  try {
    const { analysis } = await api(`/organizations/${getState().organizationId}/config-assistant/analyze`, {
      method: "POST",
      body: JSON.stringify({ kind: "text", text }),
    });
    if (analysis?.businessInfo) $("#persona-business-text").value = analysis.businessInfo;
    if (analysis?.missing?.length) {
      missing.innerHTML = `<strong>Non trouvé dans votre texte — à compléter vous-même :</strong> ${analysis.missing.map((label) => `<span class="ca-chip">${escapeHtml(label)}</span>`).join("")}`;
      missing.classList.remove("hidden");
    }
    status.textContent = "";
  } catch (error) {
    status.textContent = "";
    showToast(error.message || "L'analyse a échoué.", "error");
  } finally {
    button.disabled = false;
  }
}

async function goNext() {
  const next = $("#persona-next");
  if (currentStep === "persona") {
    if (!(selectedDomain && selectedRole && selectedTone)) return;
    currentStep = "business";
    renderStep();
    return;
  }
  if (currentStep === "business") {
    businessInfoDraft = $("#persona-business-text").value;
    next.disabled = true;
    next.textContent = "Enregistrement…";
    try {
      await savePersonaAndBusiness();
      currentStep = "whatsapp";
      renderStep();
    } catch (error) {
      next.disabled = false;
      renderStep();
      showToast(error.message || "Impossible d'enregistrer pour le moment.", "error");
    }
    return;
  }
  // currentStep === "whatsapp"
  close();
  goToWhatsApp();
}

async function skip() {
  if (currentStep !== "persona" && selectedDomain && selectedRole && selectedTone) {
    businessInfoDraft = currentStep === "business" ? $("#persona-business-text").value : businessInfoDraft;
    try { await savePersonaAndBusiness(); } catch { /* au pire, on retentera plus tard depuis « Agent IA ». */ }
  } else {
    try { await api(`/organizations/${getState().organizationId}/ai-settings/persona-seen`, { method: "POST" }); } catch { /* idem */ }
  }
  close();
}

function selectFrom(list, key) {
  return list.find((item) => item.key === key) ?? null;
}

export function initPersonaPicker(onGoToWhatsApp = () => {}) {
  goToWhatsApp = onGoToWhatsApp;
  $("#persona-domains").addEventListener("click", (event) => {
    const button = event.target.closest(".persona-option");
    if (!button) return;
    selectedDomain = selectFrom(DOMAINS, button.dataset.key);
    renderPersonaCards();
    renderStep();
  });
  $("#persona-roles").addEventListener("click", (event) => {
    const button = event.target.closest(".persona-option");
    if (!button) return;
    selectedRole = selectFrom(ROLES, button.dataset.key);
    renderPersonaCards();
    renderStep();
  });
  $("#persona-tones").addEventListener("click", (event) => {
    const button = event.target.closest(".persona-option");
    if (!button) return;
    selectedTone = selectFrom(TONES, button.dataset.key);
    renderPersonaCards();
    renderStep();
  });
  $("#persona-business-analyze").onclick = analyzeBusinessText;
  $("#persona-next").onclick = goNext;
  $("#persona-skip").onclick = skip;
}

/** Affiche le guide de démarrage une seule fois, à la toute première connexion du propriétaire. */
export async function checkFirstLoginPersona() {
  if (isAgentRole() || !getState().organizationId) return;
  try {
    const { settings } = await api(`/organizations/${getState().organizationId}/ai-settings`);
    if (settings.personaPromptedAt) return;
    selectedDomain = null;
    selectedRole = null;
    selectedTone = null;
    currentStep = "persona";
    businessInfoDraft = "";
    $("#persona-business-text").value = "";
    $("#persona-business-status").textContent = "";
    $("#persona-business-missing").classList.add("hidden");
    renderPersonaCards();
    renderStep();
    $("#persona-modal").classList.remove("hidden");
  } catch {
    // Si la vérification échoue, on ne bloque jamais l'accès au tableau de bord.
  }
}
