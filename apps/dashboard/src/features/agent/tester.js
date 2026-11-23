import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { formatMoney } from "../../utils/format.js";
import { icon } from "../../ui/icons.js";

/**
 * Testeur de l'agent : simule une vraie conversation WhatsApp sans rien enregistrer ni envoyer.
 * Le serveur renvoie les messages que le client recevrait (texte, photos de produits) et la liste de ce qui se
 * serait passé (rendez-vous, commande, passage de main…). L'état simulé (rendez-vous / commande) est renvoyé à chaque tour.
 */

const MAX_FILE_BYTES = 3 * 1024 * 1024;

/** Chaque élément : { role: "user"|"assistant", content, media?, replies?, effects? } */
let turns = [];
let simulation = { booking: null, order: null, negotiation: null };
let busy = false;

const MEDIA_LABELS = {
  payment_proof: { iconName: "receipt", text: "Preuve de paiement" },
  product_photo: { iconName: "camera", text: "Photo d'un produit" },
  document: { iconName: "file", text: "Document" },
  file: { iconName: "paperclip", text: "Fichier" },
};

/** Ce que l'agent aurait fait pour de vrai (rendez-vous, commande, photo, passage de main…) : une icône par type. */
const EFFECT_ICONS = { welcome: "sparkles", file: "paperclip", booking: "calendar-check", order: "bag", handoff: "hand", photo: "image", negotiation: "handshake", stage: "tag", claim: "shield-alert", missing: "question" };

function historyForServer() {
  return turns.map((turn) => ({ role: turn.role, content: turn.content }));
}

function bubbleMarkup(turn) {
  if (turn.role === "user") {
    const label = turn.media ? MEDIA_LABELS[turn.media] || MEDIA_LABELS.file : null;
    const media = label ? `<span class="test-media-tag">${icon(label.iconName, "icon-xs")}${escapeHtml(label.text)}</span>` : "";
    return `<div class="agent-test-bubble prospect">${media}${turn.text ? `<span>${escapeHtml(turn.text)}</span>` : ""}</div>`;
  }
  const replies = (turn.replies || [{ type: "text", text: turn.content }])
    .map((reply) => (reply.type === "image"
      ? `<div class="agent-test-bubble agent has-image"><img src="${escapeHtml(reply.imageUrl)}" alt="Photo envoyée par l'agent" loading="lazy" />${reply.caption ? `<span>${escapeHtml(reply.caption)}</span>` : ""}</div>`
      : `<div class="agent-test-bubble agent">${escapeHtml(reply.text)}</div>`))
    .join("");
  const effects = (turn.effects || []).length
    ? `<ul class="test-effects">${turn.effects.map((effect) => `<li class="effect-${escapeHtml(effect.type)}">${icon(EFFECT_ICONS[effect.type] || "zap", "icon-xs")}${escapeHtml(effect.label)}</li>`).join("")}</ul>`
    : "";
  return `<div class="agent-test-turn">${replies}${effects}</div>`;
}

const SUGGESTIONS = ["Bonjour, vous vendez quoi ?", "Quels sont vos prix ?", "Vous livrez dans mon quartier ?"];

function emptyMarkup() {
  return `<div class="tester-empty">
    <span class="empty-icon">${icon("chats")}</span>
    <p class="empty-title">Parlez à votre agent comme un client</p>
    <p class="empty-text">Vous voyez exactement ce qu'il répondrait, et ce qu'il ferait : rendez-vous, commande, photos, passage de main.</p>
    <div class="tester-suggestions">${SUGGESTIONS.map((text) => `<button type="button" class="chip" data-test-suggestion>${escapeHtml(text)}</button>`).join("")}</div>
  </div>`;
}

function render() {
  const container = $("#agent-test-messages");
  container.innerHTML = turns.length
    ? turns.map(bubbleMarkup).join("") + (busy ? '<div class="agent-test-bubble agent typing" aria-label="L\'agent écrit"><i></i><i></i><i></i></div>' : "")
    : emptyMarkup();
  container.scrollTop = container.scrollHeight;

  const state = $("#agent-test-state");
  const parts = [];
  if (simulation.booking) {
    const start = new Date(simulation.booking.startsAt);
    parts.push({ iconName: "calendar-check", text: `Rendez-vous simulé : ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" }).format(start)}` });
  }
  if (simulation.order) {
    parts.push({ iconName: "bag", text: `Commande simulée : ${simulation.order.items.map((line) => `${line.quantity} × ${line.name}`).join(", ")}` });
  }
  if (simulation.negotiation) {
    parts.push({ iconName: "handshake", text: `Négociation simulée : ${formatMoney(simulation.negotiation.currentPrice)} (tour ${simulation.negotiation.round}/3)` });
  }
  state.classList.toggle("hidden", !parts.length);
  state.innerHTML = parts.map((part) => `<span>${icon(part.iconName, "icon-xs")}${escapeHtml(part.text)}</span>`).join("");
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Impossible de lire ce fichier."));
    reader.readAsDataURL(file);
  });
}

/** `media` : { kind: "image"|"document", simulatedKind?, mimeType?, dataBase64? } ou null. */
async function send(media, mediaTag) {
  if (busy) return;
  const input = $("#agent-test-input");
  const text = input.value.trim();
  if (!text && !media) return;

  busy = true;
  const controls = [$("#agent-test-send"), input, ...$$(".agent-test-attach button")];
  controls.forEach((control) => { control.disabled = true; });
  const placeholder = media ? (media.kind === "document" ? "[Document reçu]" : "[Photo reçue]") : "";
  const message = text || placeholder;
  const userTurn = { role: "user", content: message, text, media: mediaTag || null };
  const history = historyForServer();
  turns = [...turns, userTurn];
  input.value = "";
  render();

  try {
    const result = await api(`/organizations/${getState().organizationId}/ai-test/reply`, {
      method: "POST",
      body: JSON.stringify({
        message,
        history,
        simulation,
        ...(media ? { media: { ...media, ...(text ? { caption: text } : {}) } } : {}),
      }),
    });
    document.dispatchEvent(new Event("brayano:onboarding-changed"));
    simulation = result.simulation || simulation;
    turns = [...turns, { role: "assistant", content: result.reply, replies: result.replies, effects: result.effects }];
    const info = $("#agent-test-result");
    const hasQualification = result.qualificationStatus && result.leadScore !== undefined;
    info.classList.toggle("hidden", !hasQualification);
    if (hasQualification) {
      const labels = { not_qualified: "Pas encore qualifié", qualifying: "En cours de qualification", qualified: "Qualifié" };
      info.textContent = `${labels[result.qualificationStatus] || result.qualificationStatus} · Intérêt : ${result.leadScore}/100${result.productName ? ` · Produit retenu : ${result.productName}` : ""}`;
    }
  } catch (error) {
    turns = turns.slice(0, -1);
    input.value = text;
    showToast(error.message || "Impossible de tester l'agent.", "error");
  } finally {
    busy = false;
    controls.forEach((control) => { control.disabled = false; });
    render();
    input.focus();
  }
}

export function resetTester() {
  turns = [];
  simulation = { booking: null, order: null, negotiation: null };
  $("#agent-test-result").classList.add("hidden");
  render();
}

async function onFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) return showToast("Fichier trop lourd pour le test (3 Mo maximum).", "error");
  try {
    const dataBase64 = await readFileAsBase64(file);
    await send({ kind: file.type === "application/pdf" ? "document" : "image", mimeType: file.type, dataBase64 }, "file");
  } catch (error) {
    showToast(error.message, "error");
  }
}

export function initTester() {
  $("#agent-test-form").onsubmit = (event) => {
    event.preventDefault();
    void send(null, null);
  };
  $("#clear-agent-test").onclick = resetTester;
  // Suggestions de l'état vide : un clic envoie la question, pour montrer tout de suite l'agent à l'œuvre.
  $("#agent-test-messages").addEventListener("click", (event) => {
    const suggestion = event.target.closest("[data-test-suggestion]");
    if (!suggestion) return;
    $("#agent-test-input").value = suggestion.textContent;
    void send(null, null);
  });
  render();
  $$("[data-test-media]").forEach((button) => {
    button.onclick = () => {
      const kind = button.dataset.testMedia;
      void send({ kind: kind === "document" ? "document" : "image", simulatedKind: kind }, kind);
    };
  });
  $("#agent-test-file-button").onclick = () => $("#agent-test-file").click();
  $("#agent-test-file").onchange = onFile;
}
