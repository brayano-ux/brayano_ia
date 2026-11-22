import { $ } from "../../utils/dom.js";

/**
 * Pastille d'état de l'en-tête. Elle reflète la connexion WhatsApp réelle (la seule chose qui compte pour le
 * propriétaire), jamais un « système opérationnel » décoratif. Alimentée par la vue d'ensemble et la page WhatsApp.
 */
const LABELS = {
  CONNECTED: { text: "WhatsApp connecté", tone: "status-ok" },
  QR_PENDING: { text: "WhatsApp : à relier", tone: "status-warn" },
  DISCONNECTED: { text: "WhatsApp déconnecté", tone: "status-off" },
};

export function setSystemStatus(status) {
  const pill = $("#system-status");
  if (!pill) return;
  const entry = LABELS[status] || { text: "WhatsApp : état inconnu", tone: "" };
  pill.classList.remove("status-ok", "status-warn", "status-off");
  if (entry.tone) pill.classList.add(entry.tone);
  const text = pill.querySelector(".system-status-text");
  if (text) text.textContent = entry.text;
  pill.title = `${entry.text} — cliquer pour ouvrir la page WhatsApp`;
  // Le même état est rappelé par un point dans le menu, à côté de « WhatsApp ».
  const dot = $("#nav-wa-dot");
  if (dot) dot.className = `dot${status === "CONNECTED" ? " success" : status === "QR_PENDING" ? " warning" : status === "DISCONNECTED" ? " danger" : ""}`;
}
