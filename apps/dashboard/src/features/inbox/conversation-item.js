import { escapeHtml } from "../../utils/dom.js";
import { formatListTime, formatPhone } from "../../utils/format.js";
import { previewOf, STAGE_LABELS, STAGE_TONES } from "../../utils/labels.js";
import { avatarMarkup } from "../../ui/avatar.js";
import { icon } from "../../ui/icons.js";

/**
 * Rendu partagé d'une ligne de conversation, utilisé à la fois par l'accueil (dernières conversations)
 * et par la liste de la page « Conversations ».
 */
export function getConversationStatusLabel(item) {
  if (item.status === "CLOSED") return "Fermée";
  if (item.status === "HUMAN_HANDOFF") return "Attend une personne";
  if (!item.aiEnabled) return "Agent en pause";
  return "Agent actif";
}

export function conversationStatusTone(item) {
  if (item.status === "HUMAN_HANDOFF") return "warning";
  if (item.status === "CLOSED" || !item.aiEnabled) return "neutral";
  return "success";
}

export function contactName(contact) {
  return contact?.displayName || formatPhone(contact?.whatsappJid) || "Contact";
}

/** Dernier message : la liste légère renvoie `lastMessage` ; l'ancien format renvoyait tout le fil. */
function lastMessageOf(item) {
  return item.lastMessage || item.messages?.[item.messages.length - 1] || null;
}

/** Badge de l'étape de suivi (Nouveau, Intéressé, A commandé, À rappeler). */
export function stageBadge(stage) {
  const key = stage || "NEW";
  return `<span class="badge ${STAGE_TONES[key] || "neutral"}">${escapeHtml(STAGE_LABELS[key] || key)}</span>`;
}

/**
 * @param {object} item conversation renvoyée par l'API
 * @param {{ activeId?: string }} [options] conversation ouverte dans le volet de lecture
 */
export function conversationMarkup(item, { activeId } = {}) {
  const name = contactName(item.contact);
  const lastMessage = lastMessageOf(item);
  const author = lastMessage?.author;
  // Une petite icône dit qui a écrit en dernier : l'agent (étincelles) ou l'équipe (flèche de réponse).
  const authorIcon = author === "AI" ? icon("sparkles", "icon-xs") : author === "HUMAN" ? icon("reply", "icon-xs") : "";
  const tags = [];
  if (item.status === "HUMAN_HANDOFF") tags.push(`<span class="badge warning">${icon("hand")}Attend une personne</span>`);
  else if (item.status === "CLOSED") tags.push('<span class="badge neutral">Fermée</span>');
  else if (!item.aiEnabled) tags.push(`<span class="badge neutral">${icon("pause")}Agent en pause</span>`);
  if (item.paymentCheckPending) tags.push(`<span class="badge warning" title="Le client a envoyé une preuve de paiement">${icon("receipt")}Paiement à vérifier</span>`);
  if (item.startedFromAd) tags.push(`<span class="badge violet" title="Ce client est arrivé en cliquant sur une publicité Facebook ou Instagram">${icon("megaphone")}Publicité</span>`);
  if (item.contact?.optedOut) tags.push(`<span class="badge neutral" title="Ce client a demandé à ne plus recevoir d'annonces">${icon("bell-off")}STOP</span>`);

  return `
    <div class="conversation-row${item.unread ? " unread" : ""}${activeId && activeId === item.id ? " active" : ""}" data-id="${escapeHtml(item.id)}" role="button" tabindex="0">
      ${avatarMarkup(item.contact?.displayName || "", { seed: item.contact?.whatsappJid || item.id })}
      <div class="conversation-main">
        <div class="conversation-top">
          <strong class="truncate">${escapeHtml(name)}</strong>
          <time>${escapeHtml(lastMessage ? formatListTime(lastMessage.createdAt) : "")}</time>
        </div>
        <div class="conversation-preview">
          <p class="truncate">${authorIcon}${escapeHtml(previewOf(lastMessage))}</p>
          ${item.unread ? '<i class="unread-dot" aria-label="Nouveau message"></i>' : ""}
        </div>
        <div class="conversation-tags">${stageBadge(item.stage)}${tags.join("")}</div>
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
