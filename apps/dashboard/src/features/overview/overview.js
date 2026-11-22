import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { formatNumber, plural } from "../../utils/format.js";
import { buildProspectsCsv, downloadCsv } from "../../utils/csv.js";
import { getState, setState } from "../../state/store.js";
import { conversationMarkup, bindConversationRows, contactName } from "../inbox/conversation-item.js";
import { updateRealtimeHeader } from "../navigation/navigation.js";
import { isAgentRole } from "../navigation/roles.js";
import { updateBadges } from "../inbox/inbox.js";
import { loadStats, initStats, getLatestStats } from "./stats.js";
import { setSystemStatus } from "../navigation/system-status.js";
import { avatarMarkup } from "../../ui/avatar.js";
import { icon } from "../../ui/icons.js";

/**
 * Accueil : d'abord ce qui attend une action (« À traiter ») et les derniers échanges, puis les résultats
 * de la période choisie (voir stats.js). Les actions de navigation sont fournies par app.js.
 */
let handlers = { openConversation: () => {}, openInbox: () => {}, openOrders: () => {}, openView: () => {}, openAgentSection: () => {} };
let whatsappStatus = null;
let showAllTodo = false;

/** Nombre d'actions visibles avant « Afficher tout » : la carte reste courte, surtout sur téléphone. */
const TODO_VISIBLE = 6;

function getDateWindow(days) {
  if (days === "all") return null;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days === "today" ? 0 : days === "7d" ? 6 : 29));
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function countMessagesForPeriod(metric, period) {
  if (period === "all") return metric.totalMessages;
  const window = getDateWindow(period);
  if (!window) return metric.totalMessages;

  const relevantDays = metric.messagesByDay.filter(({ day }) => {
    const value = new Date(`${day}T00:00:00`);
    return value >= window.start && value <= window.end;
  });
  return relevantDays.reduce((sum, item) => sum + item.count, 0);
}

export function renderCommercialMetrics() {
  const list = $("#commercial-metrics-list");
  if (!list) return;

  const period = $("#commercial-period")?.value || "today";
  const sortedMetrics = [...getState().commercialMetrics]
    .map((entry) => ({ ...entry, visibleCount: countMessagesForPeriod(entry, period) }))
    .sort((a, b) => b.visibleCount - a.visibleCount);

  // Sans commercial configuré (la grande majorité des commerces), le panneau n'a rien à dire : on le masque.
  $(".commercial-panel")?.classList.toggle("hidden", !sortedMetrics.length);
  if (!sortedMetrics.length) {
    list.innerHTML = "";
    return;
  }

  const max = Math.max(1, ...sortedMetrics.map((entry) => entry.visibleCount));
  list.innerHTML = sortedMetrics
    .map((entry) => {
      const latestEntry = entry.messagesByDay[0];
      const latestDay = latestEntry
        ? new Date(`${latestEntry.day}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
        : null;
      return `
        <div class="list-row commercial-item">
          ${avatarMarkup(entry.name, { seed: entry.name })}
          <div class="list-main">
            <span class="list-title truncate">${escapeHtml(entry.name)}</span>
            <span class="list-sub truncate">${escapeHtml(entry.locationName || "")}${latestDay ? ` · dernier message le ${escapeHtml(latestDay)}` : ""}</span>
          </div>
          <div class="commercial-bar" aria-hidden="true"><div class="progress"><span style="width:${Math.round((entry.visibleCount / max) * 100)}%"></span></div></div>
          <div class="commercial-count"><strong class="num">${formatNumber(entry.visibleCount)}</strong><small>message${entry.visibleCount > 1 ? "s" : ""}</small></div>
        </div>
      `;
    })
    .join("");
}

export async function exportProspects() {
  const button = $("#export-prospects");
  button?.classList.add("is-loading");
  if (button) button.disabled = true;
  try {
    const { conversations: prospects = [] } = await api(`/organizations/${getState().organizationId}/prospects/export`);
    const csv = buildProspectsCsv(prospects);
    downloadCsv(csv, `prospects-${new Date().toISOString().slice(0, 10)}.csv`);
    showToast(`${prospects.length} prospect${prospects.length > 1 ? "s" : ""} exporté${prospects.length > 1 ? "s" : ""}.`, "success");
  } catch (error) {
    showToast(error.message || "Impossible d'exporter les prospects.", "error");
  } finally {
    button?.classList.remove("is-loading");
    if (button) button.disabled = false;
  }
}

/* ----------------------------------------------------------------- À traiter */

function names(conversations, limit = 2) {
  const shown = conversations.slice(0, limit).map((item) => contactName(item.contact));
  const rest = conversations.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} et ${rest} autre${rest > 1 ? "s" : ""}` : shown.join(shown.length === 2 ? " et " : ", ");
}

/** Liste ordonnée par urgence de ce qui attend une action. Chaque entrée sait où emmener l'utilisateur. */
function todoItems() {
  const conversations = getState().conversations || [];
  const stats = getLatestStats();
  const items = [];

  if (whatsappStatus && whatsappStatus !== "CONNECTED") {
    items.push({
      tone: "danger", iconName: "whatsapp",
      title: whatsappStatus === "QR_PENDING" ? "Terminez la connexion de WhatsApp" : "WhatsApp n'est pas connecté",
      text: isAgentRole() ? "L'agent ne peut pas répondre aux clients. Prévenez le responsable du compte." : "Votre agent ne peut pas répondre tant que votre numéro n'est pas relié.",
      action: isAgentRole() ? null : "Connecter",
      run: () => handlers.openView("whatsapp"),
    });
  }

  const handoffs = conversations.filter((item) => item.status === "HUMAN_HANDOFF");
  if (handoffs.length) {
    items.push({
      tone: "warning", iconName: "hand",
      title: handoffs.length > 1 ? `${formatNumber(handoffs.length)} clients attendent une personne` : `${contactName(handoffs[0].contact)} attend une personne`,
      text: handoffs.length > 1 ? `${names(handoffs)} : l'agent vous a passé la main.` : "L'agent vous a passé la main pour cette conversation.",
      action: "Répondre",
      run: () => (handoffs.length === 1 ? handlers.openConversation(handoffs[0].id) : handlers.openInbox("TO_HANDLE")),
    });
  }

  const payments = conversations.filter((item) => item.paymentCheckPending);
  if (payments.length) {
    items.push({
      tone: "warning", iconName: "receipt",
      title: payments.length > 1 ? `${formatNumber(payments.length)} paiements à vérifier` : "1 paiement à vérifier",
      text: `${names(payments)} ${payments.length > 1 ? "ont" : "a"} envoyé une preuve de paiement.`,
      action: "Vérifier",
      run: () => (payments.length === 1 ? handlers.openConversation(payments[0].id) : handlers.openInbox("TO_HANDLE")),
    });
  }

  const counted = new Set([...handoffs, ...payments].map((item) => item.id));
  const unread = conversations.filter((item) => item.unread && !counted.has(item.id));
  if (unread.length) {
    items.push({
      tone: "primary", iconName: "chats",
      title: plural(unread.length, "conversation non lue", "conversations non lues"),
      text: `${names(unread)} ${unread.length > 1 ? "ont" : "a"} écrit récemment.`,
      action: "Lire",
      run: () => (unread.length === 1 ? handlers.openConversation(unread[0].id) : handlers.openInbox("TO_HANDLE")),
    });
  }

  if (stats?.pending?.newOrders) {
    items.push({
      tone: "success", iconName: "bag",
      title: plural(stats.pending.newOrders, "nouvelle commande à confirmer", "nouvelles commandes à confirmer"),
      text: "Confirmez-les pour prévenir vos clients et préparer la livraison.",
      action: "Voir",
      run: () => handlers.openOrders("NEW"),
    });
  }

  if (stats?.pending?.appointmentsToday) {
    items.push({
      tone: "violet", iconName: "calendar",
      title: plural(stats.pending.appointmentsToday, "rendez-vous aujourd'hui", "rendez-vous aujourd'hui"),
      text: "Consultez l'heure et le nom de chaque client attendu.",
      action: "Voir",
      run: () => handlers.openView("appointments"),
    });
  }

  const callbacks = conversations.filter((item) => item.stage === "CALLBACK" && item.status !== "CLOSED" && !counted.has(item.id) && !item.unread);
  if (callbacks.length) {
    items.push({
      tone: "neutral", iconName: "call",
      title: plural(callbacks.length, "client à rappeler", "clients à rappeler"),
      text: `${names(callbacks)} ${callbacks.length > 1 ? "attendent" : "attend"} votre appel ou votre message.`,
      action: "Voir",
      run: () => handlers.openInbox("CALLBACK"),
    });
  }

  if (stats?.pending?.unpaidOrders) {
    items.push({
      tone: "neutral", iconName: "banknote",
      title: plural(stats.pending.unpaidOrders, "commande à encaisser", "commandes à encaisser"),
      text: "Marquez-les comme payées dès que vous recevez l'argent.",
      action: "Voir",
      run: () => handlers.openOrders("UNPAID"),
    });
  }

  if (!isAgentRole() && stats?.unanswered?.count) {
    items.push({
      tone: "neutral", iconName: "question",
      title: plural(stats.unanswered.count, "question restée sans réponse", "questions restées sans réponse"),
      text: "Votre agent n'avait pas l'information. Ajoutez-la pour qu'il sache répondre.",
      action: "Compléter",
      run: () => handlers.openAgentSection("knowledge", "#business-info"),
    });
  }
  return items;
}

const TILE_TONES = { danger: "danger", warning: "warning", success: "success", violet: "violet", primary: "primary-tile", neutral: "" };

export function renderTodo() {
  const list = $("#todo-list");
  if (!list) return;
  const items = todoItems();
  const count = $("#todo-count");
  count.hidden = !items.length;
  count.textContent = String(items.length);
  count.classList.toggle("primary-count", items.length > 0);
  $("#todo-subtitle").textContent = items.length ? "Ce qui attend une action de votre part." : "Rien n'attend d'action pour le moment.";
  if (!items.length) {
    list.innerHTML = `<div class="empty empty-compact"><span class="empty-icon success-icon">${icon("check-circle")}</span><p class="empty-title">Tout est à jour</p><p class="empty-text">Aucune action en attente. Votre agent s'occupe des nouveaux messages.</p></div>`;
    return;
  }
  const limit = window.matchMedia("(max-width: 767px)").matches ? TODO_VISIBLE - 2 : TODO_VISIBLE;
  const visible = showAllTodo || items.length <= limit + 1 ? items : items.slice(0, limit);
  const hidden = items.length - visible.length;
  list.innerHTML = visible.map((item, index) => `
    <button type="button" class="list-row todo-item" data-todo="${index}">
      <span class="icon-tile ${TILE_TONES[item.tone] ?? ""}">${icon(item.iconName)}</span>
      <span class="list-main"><span class="list-title">${escapeHtml(item.title)}</span><span class="list-sub">${escapeHtml(item.text)}</span></span>
      ${item.action ? `<span class="todo-action">${escapeHtml(item.action)}${icon("chevron-right", "icon-sm")}</span>` : ""}
    </button>`).join("")
    + (hidden > 0 ? `<button type="button" class="list-row todo-more" id="todo-more">${icon("chevron-down", "icon-sm")}Afficher ${hidden === 1 ? "l'autre action" : `les ${hidden} autres actions`}</button>` : "");
  list.querySelectorAll("[data-todo]").forEach((button) => {
    button.onclick = () => items[Number(button.dataset.todo)]?.run();
  });
  const more = $("#todo-more");
  if (more) more.onclick = () => {
    showAllTodo = true;
    renderTodo();
  };
}

/* ------------------------------------------------------- Dernières conversations */

export function renderRecent() {
  const target = $("#recent-conversations");
  const conversations = [...(getState().conversations || [])]
    .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0))
    .slice(0, window.matchMedia("(max-width: 767px)").matches ? 4 : 5);
  target.innerHTML = conversations.length
    ? conversations.map((item) => conversationMarkup(item)).join("")
    : `<div class="empty empty-compact"><span class="empty-icon">${icon("chats")}</span><p class="empty-title">Aucune conversation pour le moment</p><p class="empty-text">Dès qu'un client écrira sur votre WhatsApp, l'échange apparaîtra ici.</p></div>`;
  bindConversationRows(target, (id) => handlers.openConversation(id));
}

/**
 * @param {{ openConversation: (id: string) => void, openInbox: (filter: string) => void, openOrders: (filter: string) => void, openView: (view: string) => void, openAgentSection: (tab: string, focus: string) => void }} [nextHandlers]
 */
export async function refreshOverview(nextHandlers) {
  if (nextHandlers) handlers = { ...handlers, ...nextHandlers };
  const orgId = getState().organizationId;
  if (!orgId) return;
  const orgLabel = $("#org-select").selectedOptions[0]?.textContent || getState().organizationName || "Brayano IA";
  $("#current-org").textContent = orgLabel;
  $("#org-initial").textContent = orgLabel[0]?.toUpperCase() || "B";
  updateRealtimeHeader();

  try {
    const [list, status, metrics] = await Promise.all([
      api(`/organizations/${orgId}/conversations`),
      api(`/organizations/${orgId}/whatsapp/status`),
      api(`/organizations/${orgId}/routing/commercial-metrics`),
    ]);

    const conversations = list.conversations || [];
    setState({ conversations, commercialMetrics: metrics.commercialMetrics || [] });
    whatsappStatus = status.status;
    setSystemStatus(status.status);
    renderCommercialMetrics();
    renderRecent();
    renderTodo();
    updateBadges(conversations);
    await loadStats({ onLoaded: renderTodo, openConversation: handlers.openConversation, openAgentSection: handlers.openAgentSection });
  } catch (error) {
    showToast(error.message, "error");
  }
}

export function initOverview() {
  $("#commercial-period")?.addEventListener("change", renderCommercialMetrics);
  $("#export-prospects")?.addEventListener("click", exportProspects);
  $(".quick-panel")?.addEventListener("click", (event) => {
    const quick = event.target.closest("[data-quick]")?.dataset.quick;
    if (quick === "product") handlers.openView("products", { addProduct: true });
    else if (quick === "test") handlers.openAgentSection("knowledge", "#agent-test-input");
  });
  initStats();
}
