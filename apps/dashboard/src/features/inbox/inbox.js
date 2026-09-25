import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { formatDateTime } from "../../utils/format.js";
import { getState } from "../../state/store.js";
import { conversationMarkup, bindConversationRows } from "./conversation-item.js";

export function renderInbox() {
  const { conversations } = getState();
  $("#inbox-total").textContent = `${conversations.length} conversation${conversations.length > 1 ? "s" : ""}`;
  const target = $("#all-conversations");
  target.innerHTML = conversations.length
    ? conversations.map(conversationMarkup).join("")
    : '<div class="empty-state">Aucune conversation pour le moment.</div>';
  bindConversationRows(target, openConversation);
}

function conversationDetailStatusLabel(conversation) {
  if (conversation.status === "CLOSED") return "Conversation fermée";
  if (conversation.status === "HUMAN_HANDOFF") return "En attente d'un humain";
  return conversation.aiEnabled ? "Agent IA actif" : "Prise en main humaine";
}

function messageBubbleMarkup(message) {
  const isFromContact = message.author === "CONTACT";
  return `
    <div class="thread-bubble ${isFromContact ? "from-contact" : "from-agent"}">
      <span>${escapeHtml(message.content)}</span>
      <time>${formatDateTime(message.createdAt)}</time>
    </div>
  `;
}

export async function openConversation(id) {
  try {
    const orgId = getState().organizationId;
    const data = await api(`/organizations/${orgId}/conversations/${id}`);
    const conversation = data.conversation;
    const name = conversation.contact?.displayName || conversation.contact?.whatsappJid || "Contact";
    const statusLabel = conversationDetailStatusLabel(conversation);
    const detailPanel = $("#conversation-detail");

    detailPanel.classList.add("has-conversation");
    detailPanel.innerHTML = `
      <div class="panel-heading">
        <div>
          <h2>${escapeHtml(name)}</h2>
          <p class="muted">${escapeHtml(statusLabel)}</p>
        </div>
        <button class="ghost-button" id="toggle-ai">${conversation.aiEnabled ? "Désactiver l'IA" : "Réactiver l'IA"}</button>
      </div>
      <div class="conversation-thread">${(conversation.messages || []).map(messageBubbleMarkup).join("")}</div>
      <form id="reply-form" class="reply-form">
        <input required placeholder="Écrire une réponse..." />
        <button class="primary">Envoyer</button>
      </form>
    `;

    $("#toggle-ai").onclick = () => toggleAi(id, conversation.aiEnabled);
    $("#reply-form").onsubmit = (event) => sendReply(event, id);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function sendReply(event, id) {
  event.preventDefault();
  const input = event.target.querySelector("input");
  const orgId = getState().organizationId;

  try {
    await api(`/organizations/${orgId}/conversations/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ text: input.value }),
    });
    input.value = "";
    showToast("Réponse envoyée", "success");
    await refreshAndReopen(id);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function toggleAi(id, enabled) {
  const orgId = getState().organizationId;
  try {
    await api(`/organizations/${orgId}/conversations/${id}/ai/${enabled ? "disable" : "enable"}`, { method: "POST" });
    showToast(enabled ? "IA désactivée" : "IA réactivée", "success");
    await refreshAndReopen(id);
  } catch (error) {
    showToast(error.message, "error");
  }
}

let refreshCallback = async () => {};

/** Permet à app.js d'injecter le refresh global sans dépendance circulaire. */
export function bindInboxRefresh(callback) {
  refreshCallback = callback;
}

async function refreshAndReopen(id) {
  await refreshCallback();
  await openConversation(id);
}

export function initInbox() {
  // Rien à câbler au chargement initial : la vue se peuple via renderInbox().
}
