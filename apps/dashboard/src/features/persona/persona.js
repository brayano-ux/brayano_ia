import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { isAgentRole } from "../navigation/roles.js";

/**
 * Fenêtre affichée une seule fois, à la première connexion du propriétaire : elle compose le
 * système-prompt de l'agent à partir d'un domaine, d'un rôle et d'un ton choisis parmi des cartes.
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

let selectedDomain = null;
let selectedRole = null;
let selectedTone = null;

function cardMarkup(item, selectedKey) {
  const selected = item.key === selectedKey;
  return `
    <button type="button" class="persona-option${selected ? " selected" : ""}" data-key="${escapeHtml(item.key)}" role="radio" aria-checked="${selected}">
      <span class="persona-emoji" aria-hidden="true">${item.emoji}</span>
      <strong>${escapeHtml(item.label)}</strong>
      <small>${escapeHtml(item.blurb)}</small>
    </button>`;
}

function render() {
  $("#persona-domains").innerHTML = DOMAINS.map((domain) => cardMarkup(domain, selectedDomain?.key)).join("");
  $("#persona-roles").innerHTML = ROLES.map((role) => cardMarkup(role, selectedRole?.key)).join("");
  $("#persona-tones").innerHTML = TONES.map((tone) => cardMarkup(tone, selectedTone?.key)).join("");
  $("#persona-confirm").disabled = !(selectedDomain && selectedRole && selectedTone);
}

function close() {
  $("#persona-modal").classList.add("hidden");
}

async function confirm() {
  if (!selectedDomain || !selectedRole || !selectedTone) return;
  const button = $("#persona-confirm");
  button.disabled = true;
  button.textContent = "Application…";
  try {
    const systemPrompt = `${selectedDomain.context} ${selectedRole.prompt} ${selectedTone.suffix}`;
    await api(`/organizations/${getState().organizationId}/ai-settings`, {
      method: "PUT",
      body: JSON.stringify({ agentDomain: selectedDomain.label, agentRole: selectedRole.label, agentTone: selectedTone.label, systemPrompt }),
    });
    close();
    showToast("Votre agent est configuré. Vous pouvez l'ajuster à tout moment dans « Agent IA ».", "success");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Appliquer et continuer";
    showToast(error.message || "Impossible d'enregistrer pour le moment.", "error");
  }
}

async function skip() {
  close();
  try {
    await api(`/organizations/${getState().organizationId}/ai-settings/persona-seen`, { method: "POST" });
  } catch {
    // Pas grave : on retentera à la prochaine connexion si l'enregistrement échoue.
  }
}

function selectFrom(list, key) {
  return list.find((item) => item.key === key) ?? null;
}

export function initPersonaPicker() {
  $("#persona-domains").addEventListener("click", (event) => {
    const button = event.target.closest(".persona-option");
    if (!button) return;
    selectedDomain = selectFrom(DOMAINS, button.dataset.key);
    render();
  });
  $("#persona-roles").addEventListener("click", (event) => {
    const button = event.target.closest(".persona-option");
    if (!button) return;
    selectedRole = selectFrom(ROLES, button.dataset.key);
    render();
  });
  $("#persona-tones").addEventListener("click", (event) => {
    const button = event.target.closest(".persona-option");
    if (!button) return;
    selectedTone = selectFrom(TONES, button.dataset.key);
    render();
  });
  $("#persona-confirm").onclick = confirm;
  $("#persona-skip").onclick = skip;
}

/** Affiche le choix de personnalité une seule fois, à la toute première connexion du propriétaire. */
export async function checkFirstLoginPersona() {
  if (isAgentRole() || !getState().organizationId) return;
  try {
    const { settings } = await api(`/organizations/${getState().organizationId}/ai-settings`);
    if (settings.personaPromptedAt) return;
    selectedDomain = null;
    selectedRole = null;
    selectedTone = null;
    render();
    $("#persona-modal").classList.remove("hidden");
  } catch {
    // Si la vérification échoue, on ne bloque jamais l'accès au tableau de bord.
  }
}
