import { escapeHtml } from "../../utils/dom.js";
import { formatTime, initials } from "../../utils/format.js";

/**
 * Rendu partagé d'une ligne de conversation, utilisé à la fois par
 * la vue "Aperçu" (conversations récentes) et la "Boîte de réception".
 */
export function getConversationStatusLabel(item) {
  if (item.status === "CLOSED") return "Fermée";
  if (item.status === "HUMAN_HANDOFF") return "Handoff humain";
  if (!item.aiEnabled) return "IA désactivée";
  return "Actif";
}

export function conversationMarkup(item) {
  const name = item.contact?.displayName || item.contact?.whatsappJid || "Contact";
  const lastMessage = item.messages?.[item.messages.length - 1];
  const statusLabel = getConversationStatusLabel(item);

  return `
    <div class="conversation-row" data-id="${escapeHtml(item.id)}">
      <span class="contact-avatar">${escapeHtml(initials(name))}</span>
      <div class="conversation-main">
        <strong>${escapeHtml(name)}</strong>
        <p>${escapeHtml(lastMessage?.content || "Aucun message")}</p>
      </div>
      <div class="conversation-meta">
        ${lastMessage ? formatTime(lastMessage.createdAt) : ""}
        <span class="unread">${escapeHtml(statusLabel)}</span>
      </div>
    </div>
  `;
}

export function bindConversationRows(container, onSelect) {
  container.querySelectorAll(".conversation-row").forEach((row) => {
    row.onclick = () => onSelect(row.dataset.id);
  });
}
