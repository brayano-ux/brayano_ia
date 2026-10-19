import { escapeHtml } from "../../utils/dom.js";
import { formatTime, initials } from "../../utils/format.js";
import { previewOf, STAGE_LABELS, STAGE_TONES } from "../../utils/labels.js";

/**
 * Rendu partagé d'une ligne de conversation, utilisé à la fois par
 * la vue "Aperçu" (conversations récentes) et la "Boîte de réception".
 */
export function getConversationStatusLabel(item) {
  if (item.status === "CLOSED") return "Fermée";
  if (item.status === "HUMAN_HANDOFF") return "Attend une personne";
  if (!item.aiEnabled) return "IA en pause";
  return "IA active";
}

function statusTone(item) {
  if (item.status === "HUMAN_HANDOFF") return "warning";
  if (item.status === "CLOSED" || !item.aiEnabled) return "neutral";
  return "success";
}

/** Dernier message : la liste légère renvoie `lastMessage` ; l'ancien format renvoyait tout le fil. */
function lastMessageOf(item) {
  return item.lastMessage || item.messages?.[item.messages.length - 1] || null;
}

export function conversationMarkup(item) {
  const name = item.contact?.displayName || item.contact?.whatsappJid?.split("@")[0] || "Contact";
  const lastMessage = lastMessageOf(item);
  const statusLabel = getConversationStatusLabel(item);
  const stage = item.stage || "NEW";
  const prefix = lastMessage?.author && lastMessage.author !== "CONTACT" ? "Vous : " : "";

  return `
    <div class="conversation-row${item.unread ? " unread" : ""}" data-id="${escapeHtml(item.id)}" role="button" tabindex="0">
      <span class="contact-avatar">${escapeHtml(initials(name))}</span>
      <div class="conversation-main">
        <strong>${escapeHtml(name)}${item.unread ? '<i class="unread-dot" aria-label="Nouveau message"></i>' : ""}</strong>
        <p>${escapeHtml(prefix + previewOf(lastMessage))}</p>
        <span class="conversation-tags">
          <span class="stage-chip stage-${STAGE_TONES[stage] || "neutral"}">${escapeHtml(STAGE_LABELS[stage] || stage)}</span>
          ${item.paymentCheckPending ? '<span class="stage-chip stage-warning" title="Le client a envoyé une preuve de paiement">💳 Paiement à vérifier</span>' : ""}
        </span>
      </div>
      <div class="conversation-meta">
        <time>${lastMessage ? formatTime(lastMessage.createdAt) : ""}</time>
        <span class="status-chip ${statusTone(item)}">${escapeHtml(statusLabel)}</span>
      </div>
    </div>
  `;
}

export function bindConversationRows(container, onSelect) {
  container.querySelectorAll(".conversation-row").forEach((row) => {
    row.onclick = () => onSelect(row.dataset.id);
    row.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(row.dataset.id);
      }
    };
  });
}
