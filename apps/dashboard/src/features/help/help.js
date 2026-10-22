import { api } from "../../services/api.js";
import { APP_CONFIG } from "../../config.js";
import { getState } from "../../state/store.js";
import { $, escapeHtml } from "../../utils/dom.js";

/**
 * Aide du tableau de bord : une icône WhatsApp qui ouvre une discussion avec le support, et un assistant intelligent
 * (côté serveur, avec la clé IA de la plateforme) qui connaît toute la configuration de Brayano IA.
 */

const GREETING = "Bonjour 👋 Je suis l'assistant d'aide de Brayano IA. Je connais toute la configuration : connecter WhatsApp, régler votre agent, ajouter vos produits, les forfaits… Posez-moi votre question, je vous guide pas à pas.";
const SUGGESTIONS = [
  "Comment connecter mon WhatsApp ?",
  "Mon agent ne répond pas aux clients",
  "Comment remplir les informations de mon entreprise ?",
  "Comment ajouter mes produits avec photos ?",
  "Comment envoyer un message à tous mes clients ?",
  "Quels sont les forfaits et les prix ?",
];
const VIEW_LABELS = {
  overview: "Vue d'ensemble", inbox: "Conversations", agent: "Agent IA", products: "Produits", appointments: "Rendez-vous",
  orders: "Commandes", broadcasts: "Messages groupés", whatsapp: "WhatsApp", billing: "Mon forfait", settings: "Paramètres",
};
const MAX_STORED = 20;

let conversation = [];
let busy = false;

const storageKey = () => `brayano_help_${getState().organizationId || "x"}`;

function loadConversation() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey()) || "[]");
    conversation = Array.isArray(stored) ? stored.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : [];
  } catch {
    conversation = [];
  }
}

function saveConversation() {
  try {
    sessionStorage.setItem(storageKey(), JSON.stringify(conversation.slice(-MAX_STORED)));
  } catch {
    // Stockage indisponible (navigation privée…) : la discussion reste simplement en mémoire.
  }
}

/** Texte → HTML sûr : **gras**, listes « 1. » et « - », retours à la ligne. */
export function renderRichText(text) {
  const inline = (line) => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const lines = String(text).replace(/\r/g, "").split("\n");
  const html = [];
  let list = null;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (numbered || bullet) {
      const kind = numbered ? "ol" : "ul";
      if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
      html.push(`<li>${inline((numbered || bullet)[1])}</li>`);
    } else if (!line) {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join("");
}

function whatsappLink(question) {
  const org = $("#org-select")?.selectedOptions?.[0]?.textContent?.trim();
  const text = question || `Bonjour, ${org ? `je suis ${org} et ` : ""}j'ai besoin d'aide sur Brayano IA.`;
  return `https://wa.me/${APP_CONFIG.supportWhatsapp}?text=${encodeURIComponent(text)}`;
}

function scrollToEnd() {
  const box = $("#help-messages");
  box.scrollTop = box.scrollHeight;
}

function bubble(message) {
  const mine = message.role === "user";
  const action = !mine && message.openView && VIEW_LABELS[message.openView]
    ? `<button type="button" class="help-open" data-open-view="${escapeHtml(message.openView)}">Ouvrir « ${escapeHtml(VIEW_LABELS[message.openView])} »</button>`
    : "";
  return `<div class="help-msg ${mine ? "mine" : "bot"}${message.error ? " error" : ""}">${mine ? `<p>${escapeHtml(message.content)}</p>` : renderRichText(message.content)}${action}</div>`;
}

function render() {
  const messages = [{ role: "assistant", content: GREETING }, ...conversation];
  $("#help-messages").innerHTML = messages.map(bubble).join("") + (busy ? '<div class="help-msg bot typing" aria-label="L\'assistant écrit"><i></i><i></i><i></i></div>' : "");
  $("#help-chips").classList.toggle("hidden", conversation.length > 0 || busy);
  $("#help-messages").querySelectorAll("[data-open-view]").forEach((button) => {
    button.onclick = () => {
      $(`.nav-item[data-view="${button.dataset.openView}"]`)?.click();
      if (window.matchMedia("(max-width: 767px)").matches) togglePanel(false);
    };
  });
  scrollToEnd();
}

function togglePanel(open) {
  const panel = $("#help-panel");
  const show = open ?? panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !show);
  $("#help-toggle").setAttribute("aria-expanded", String(show));
  if (show) {
    loadConversation();
    render();
    $("#help-input").focus();
  }
}

async function ask(question) {
  const text = question.trim();
  if (!text || busy) return;
  const organizationId = getState().organizationId;
  if (!organizationId) return;
  conversation.push({ role: "user", content: text });
  busy = true;
  $("#help-input").value = "";
  autoGrow();
  $("#help-send").disabled = true;
  render();
  try {
    const history = conversation.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    const result = await api(`/organizations/${organizationId}/support-assistant/chat`, { method: "POST", body: JSON.stringify({ messages: history }) });
    conversation.push({ role: "assistant", content: result.reply, openView: result.openView || null });
  } catch (error) {
    const message = error?.message || "L'assistant n'est pas disponible pour le moment.";
    conversation.push({ role: "assistant", error: true, content: /whatsapp/i.test(message) ? message : `${message} Vous pouvez aussi nous écrire sur WhatsApp avec l'icône verte.` });
  } finally {
    busy = false;
    $("#help-send").disabled = false;
    saveConversation();
    render();
    $("#help-input").focus();
  }
}

function autoGrow() {
  const input = $("#help-input");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
}

export function initHelp() {
  const refreshLinks = () => {
    $("#help-wa").href = whatsappLink();
    $("#help-panel-wa").href = whatsappLink();
  };
  refreshLinks();
  $("#help-wa").addEventListener("click", refreshLinks);
  $("#help-panel-wa").addEventListener("click", refreshLinks);

  $("#help-toggle").onclick = () => togglePanel();
  $("#help-close").onclick = () => togglePanel(false);
  $("#help-reset").onclick = () => {
    conversation = [];
    saveConversation();
    render();
  };
  $("#help-chips").innerHTML = SUGGESTIONS.map((label) => `<button type="button" class="help-chip">${escapeHtml(label)}</button>`).join("");
  $("#help-chips").querySelectorAll(".help-chip").forEach((chip) => { chip.onclick = () => ask(chip.textContent); });

  $("#help-form").onsubmit = (event) => {
    event.preventDefault();
    void ask($("#help-input").value);
  };
  $("#help-input").addEventListener("input", autoGrow);
  $("#help-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("#help-form").requestSubmit();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#help-panel").classList.contains("hidden")) togglePanel(false);
  });
}
