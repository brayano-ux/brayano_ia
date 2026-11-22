import { api } from "../../services/api.js";
import { getApiBaseUrl } from "../../config.js";
import { $, $$, debounce, escapeHtml, showToast } from "../../utils/dom.js";
import { formatDayLabel, formatMoney, formatPhone, formatTime } from "../../utils/format.js";
import {
  APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONES, describeAiMeta, LEAD_FIELD_LABELS,
  ORDER_STATUS_LABELS, ORDER_STATUS_TONES, STAGES, STAGE_LABELS,
} from "../../utils/labels.js";
import { getState, setState } from "../../state/store.js";
import { conversationMarkup, bindConversationRows, contactName } from "./conversation-item.js";
import { readRoute, setRouteDetail } from "../navigation/navigation.js";
import { avatarMarkup } from "../../ui/avatar.js";
import { icon } from "../../ui/icons.js";
import { setUnreadCount } from "../../ui/page-title.js";

/**
 * Conversations : liste légère (dernier message seulement) mise à jour toute seule, filtres de suivi, fil de
 * discussion avec photos et documents reçus, journal « pourquoi cette réponse ? », correction de l'agent,
 * et fiche du client (informations collectées, commandes, rendez-vous).
 */

const POLL_MS = 8000;
/** Hors de la page Conversations, on rafraîchit seulement le compteur : un tick sur 4. */
const BACKGROUND_EVERY_N_TICKS = 4;
const INFO_KEY = "brayano_inbox_info";
/** Deux messages du même auteur à moins de 5 minutes d'écart forment un seul groupe visuel. */
const GROUP_GAP_MS = 5 * 60_000;

let stageFilter = "";
let searchText = "";
let selectedId = null;
let openedVersion = null;
let openedMessageCount = 0;
let pollTimer = null;
let tick = 0;
let listSignature = "";
const seenIncoming = new Map();
let firstListLoaded = false;
let refreshCallback = async () => {};

const orgBase = () => `/organizations/${getState().organizationId}`;
const isCompact = () => window.matchMedia("(max-width: 1023px)").matches;
const isWide = () => window.matchMedia("(min-width: 1280px)").matches;

function isInboxVisible() {
  const view = $("#inbox-view");
  return Boolean(view) && !view.classList.contains("hidden");
}

/* ----------------------------------------------------------------- liste */

/** Présélectionne un filtre de la liste (« À traiter », « À rappeler »…) avant de l'afficher. */
export function setInboxFilter(value) {
  stageFilter = value || "";
}

/** Conversation qui attend une action du propriétaire. */
export function needsAttention(item) {
  return Boolean(item.unread || item.status === "HUMAN_HANDOFF" || item.stage === "CALLBACK" || item.paymentCheckPending);
}

function filteredConversations() {
  const needle = searchText.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  return getState().conversations
    .filter((item) => {
      if (stageFilter === "TO_HANDLE") { if (!needsAttention(item)) return false; }
      else if (stageFilter === "FROM_AD") { if (!item.startedFromAd) return false; }
      else if (stageFilter && item.stage !== stageFilter) return false;
      if (!needle) return true;
      const name = (item.contact?.displayName || "").toLowerCase();
      return name.includes(needle) || (digits.length >= 3 && String(item.contact?.whatsappJid || "").includes(digits));
    })
    // Comme dans une messagerie : la conversation la plus récente en premier.
    .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
}

function renderStageFilters() {
  const { conversations } = getState();
  const toHandle = conversations.filter(needsAttention).length;
  const fromAd = conversations.filter((item) => item.startedFromAd).length;
  const counts = Object.fromEntries(STAGES.map((stage) => [stage, conversations.filter((item) => item.stage === stage).length]));
  const chips = [
    { value: "", label: "Toutes", count: conversations.length },
    { value: "TO_HANDLE", label: "À traiter", count: toHandle },
    ...STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage], count: counts[stage] })),
    ...(fromAd ? [{ value: "FROM_AD", label: "Publicité", count: fromAd }] : []),
  ];
  const box = $("#inbox-stage-filters");
  const scrollLeft = box.scrollLeft;
  box.innerHTML = chips
    .map((chip) => `<button type="button" class="chip stage-filter${chip.value === stageFilter ? " active" : ""}" data-stage-filter="${chip.value}" aria-pressed="${chip.value === stageFilter}">${escapeHtml(chip.label)}<span class="chip-count">${chip.count}</span></button>`)
    .join("");
  box.scrollLeft = scrollLeft;
  $$("[data-stage-filter]", box).forEach((button) => {
    button.onclick = () => {
      stageFilter = button.dataset.stageFilter;
      renderInbox();
    };
  });
}

function emptyListMarkup(hasConversations) {
  if (hasConversations) {
    return `<div class="empty empty-compact"><span class="empty-icon">${icon("search")}</span><p class="empty-title">Aucune conversation trouvée</p><p class="empty-text">Aucun client ne correspond à cette recherche ou à ce filtre.</p><button type="button" class="btn btn-secondary btn-sm" id="inbox-clear-filters">Tout afficher</button></div>`;
  }
  return `<div class="empty"><span class="empty-icon">${icon("chats")}</span><p class="empty-title">Aucune conversation pour le moment</p><p class="empty-text">Dès qu'un client écrira sur votre WhatsApp, l'échange apparaîtra ici et votre agent lui répondra.</p></div>`;
}

export function renderInbox() {
  const all = getState().conversations;
  const visible = filteredConversations();
  const filtered = Boolean(stageFilter || searchText.trim());
  $("#inbox-total").textContent = filtered ? `${visible.length} sur ${all.length} conversation${all.length > 1 ? "s" : ""}` : `${all.length} conversation${all.length > 1 ? "s" : ""}`;
  renderStageFilters();
  const target = $("#all-conversations");
  const scrollTop = target.scrollTop;
  target.innerHTML = visible.length
    ? visible.map((item) => conversationMarkup(item, { activeId: selectedId })).join("")
    : emptyListMarkup(all.length > 0);
  target.scrollTop = scrollTop;
  bindConversationRows(target, (id) => void openConversation(id));
  const clear = $("#inbox-clear-filters");
  if (clear) clear.onclick = () => {
    stageFilter = "";
    searchText = "";
    $("#inbox-search").value = "";
    renderInbox();
  };
}

function signatureOf(conversations) {
  return conversations
    .map((item) => `${item.id}|${item.lastMessageAt}|${item.status}|${item.aiEnabled}|${item.stage}|${item.unread}|${item.paymentCheckPending}|${item.messageCount}`)
    .join(";");
}

function setBadge(element, count, title) {
  if (!element) return;
  element.textContent = count > 99 ? "99+" : String(count);
  element.classList.toggle("hidden", count === 0);
  if (title) element.title = title;
}

/** Pastilles du menu et de la barre d'onglets : nombre de conversations avec un nouveau message. */
export function updateBadges(conversations) {
  const unread = conversations.filter((item) => item.unread).length;
  const title = unread ? `${unread} conversation${unread > 1 ? "s" : ""} avec un nouveau message` : "";
  setBadge($("#nav-count"), unread, title);
  setBadge($("#tab-count"), unread, title);
  setUnreadCount(unread);
}

/** Prévient (une seule fois) quand un client écrit alors qu'on regarde autre chose. */
function announceNewMessages(conversations) {
  for (const item of conversations) {
    const key = `${item.id}|${item.lastMessageAt}`;
    if (item.unread && seenIncoming.get(item.id) !== key) {
      if (firstListLoaded && !(isInboxVisible() && item.id === selectedId)) {
        showToast(`Nouveau message de ${contactName(item.contact)}`, "info");
      }
      seenIncoming.set(item.id, key);
    }
  }
}

/** Charge la liste. `silent` : rafraîchissement automatique (aucun message d'erreur, aucun saut d'écran). */
export async function loadInbox({ silent = false } = {}) {
  if (!getState().organizationId) return;
  try {
    const { conversations } = await api(`${orgBase()}/conversations`);
    setState({ conversations });
    updateBadges(conversations);
    announceNewMessages(conversations);
    firstListLoaded = true;

    const signature = signatureOf(conversations);
    const changed = signature !== listSignature;
    listSignature = signature;
    if (isInboxVisible() && (changed || !silent)) renderInbox();

    if (!silent && isInboxVisible()) {
      // Sur téléphone, revenir sur la page montre la liste ; un lien direct vers une conversation l'ouvre.
      if (isCompact() && !document.body.classList.contains("in-thread")) showList();
      const wanted = readRoute();
      if (wanted.view === "inbox" && wanted.detail && wanted.detail !== selectedId && conversations.some((item) => item.id === wanted.detail)) {
        await openConversation(wanted.detail, { fromRoute: true });
        return;
      }
    }

    if (selectedId && isInboxVisible()) {
      const current = conversations.find((item) => item.id === selectedId);
      const opened = openedVersion;
      if (current && opened && (String(current.lastMessageAt) !== String(opened.lastMessageAt) || current.status !== opened.status || current.aiEnabled !== opened.aiEnabled || current.stage !== opened.stage || current.paymentCheckPending !== opened.paymentCheckPending)) {
        await openConversation(selectedId, { refresh: true });
      }
    }
  } catch (error) {
    if (!silent) showToast(error.message, "error");
  }
}

/* ------------------------------------------------------------------ fil */

/**
 * Pendant une prise en main humaine, l'agent reprend seul 24 h après, au prochain message du client.
 * Ce délai est une simple information : l'interrupteur « Agent IA » reste toujours disponible.
 */
function autoResumeHint(conversation) {
  if (conversation.status !== "HUMAN_HANDOFF" || conversation.aiEnabled) return "";

  const remainingMs = new Date(conversation.updatedAt).getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (remainingMs <= 0) return "L'agent reprendra dès le prochain message du client.";

  const remainingMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return `Sans action de votre part, l'agent reprend dans ${hours} h ${String(minutes).padStart(2, "0")} (au prochain message du client).`;
}

function mediaMarkup(message) {
  if (message.type !== "IMAGE" && message.type !== "DOCUMENT") return "";
  if (!message.mediaUrl) {
    return `<span class="media-missing">${icon(message.type === "IMAGE" ? "image" : "file", "icon-sm")}${message.type === "IMAGE" ? "Photo reçue (plus conservée)" : "Document reçu (plus conservé)"}</span>`;
  }
  const url = `${getApiBaseUrl()}${message.mediaUrl}`;
  if (message.type === "IMAGE") {
    return `<button type="button" class="media-thumb" data-lightbox="${escapeHtml(url)}" aria-label="Voir la photo en grand"><img src="${escapeHtml(url)}" alt="Photo envoyée par le client" loading="lazy" /></button>`;
  }
  return `<a class="media-file" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" download><span class="icon-tile">${icon("file")}</span><span class="media-file-text"><b class="truncate">${escapeHtml(message.mediaName || "Document")}</b><small>Télécharger</small></span></a>`;
}

function whyMarkup(message) {
  const lines = describeAiMeta(message.aiMeta);
  if (!lines.length || message.author !== "AI") return "";
  const canCorrect = !message.aiMeta?.kind;
  return `
    <details class="why">
      <summary>${icon("bulb", "icon-xs")}Pourquoi cette réponse ?</summary>
      <div class="why-body">
        <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        ${canCorrect ? `<button type="button" class="btn btn-sm btn-secondary" data-correct="${escapeHtml(message.id)}">${icon("edit")}Corriger cette réponse</button>` : ""}
      </div>
    </details>`;
}

/** Qui a écrit ce message sortant : l'agent, un membre de l'équipe, ou un envoi automatique. */
function senderLabel(message) {
  const kind = message.aiMeta?.kind;
  if (kind === "broadcast") return { iconName: "megaphone", text: "Message groupé" };
  if (kind === "follow_up") return { iconName: "bell", text: "Relance automatique" };
  if (kind === "welcome") return { iconName: "sparkles", text: "Message d'accueil" };
  if (message.author === "HUMAN") return { iconName: "user", text: message.aiMeta?.sentBy || "Vous" };
  return { iconName: "sparkles", text: "Agent IA" };
}

/** Texte d'un message : toujours échappé ; seules les adresses web (http/https) deviennent des liens. */
function richText(text) {
  return String(text).split(/(https?:\/\/[^\s<>"']+)/g).map((part, index) => {
    if (index % 2 === 0) return escapeHtml(part);
    const url = part.replace(/[.,;:!?)\]]+$/, "");
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>${escapeHtml(part.slice(url.length))}`;
  }).join("");
}

function messageMarkup(message, { first }) {
  const isFromContact = message.author === "CONTACT";
  const side = isFromContact ? "from-contact" : message.author === "AI" ? "from-agent" : "from-human";
  const text = message.type === "IMAGE" || message.type === "DOCUMENT"
    ? (/^\[(Photo|Document) reçu/.test(message.content) ? "" : message.content)
    : message.content;
  const label = !isFromContact && first ? senderLabel(message) : null;
  return `
    <div class="msg ${side}${first ? " is-first" : ""}" data-message-id="${escapeHtml(message.id)}">
      ${label ? `<span class="msg-author">${icon(label.iconName, "icon-xs")}${escapeHtml(label.text)}</span>` : ""}
      <div class="thread-bubble">
        ${mediaMarkup(message)}
        ${text ? `<span class="bubble-text">${richText(text)}</span>` : ""}
        <time datetime="${escapeHtml(message.createdAt)}">${escapeHtml(formatTime(message.createdAt))}</time>
      </div>
      ${whyMarkup(message)}
    </div>
  `;
}

/** Fil de discussion : séparateurs de jour, messages regroupés par auteur. */
function threadMarkup(messages) {
  if (!messages?.length) return `<div class="empty empty-compact"><p class="empty-text">Aucun message dans cette conversation.</p></div>`;
  const parts = [];
  let previous = null;
  let previousDay = "";
  for (const message of messages) {
    const date = new Date(message.createdAt);
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (day !== previousDay) {
      parts.push(`<div class="thread-day"><span>${escapeHtml(formatDayLabel(message.createdAt))}</span></div>`);
      previousDay = day;
      previous = null;
    }
    const sameAuthor = previous && previous.author === message.author && (previous.aiMeta?.kind || "") === (message.aiMeta?.kind || "") && (previous.aiMeta?.sentBy || "") === (message.aiMeta?.sentBy || "");
    const first = !sameAuthor || date.getTime() - new Date(previous.createdAt).getTime() > GROUP_GAP_MS;
    parts.push(messageMarkup(message, { first }));
    previous = message;
  }
  return parts.join("");
}

function statusLine(conversation) {
  if (conversation.status === "CLOSED") return { text: "Conversation fermée", tone: "" };
  if (conversation.status === "HUMAN_HANDOFF") return { text: "Attend une réponse de votre part", tone: "warning" };
  return conversation.aiEnabled ? { text: "L'agent répond automatiquement", tone: "success" } : { text: "Agent en pause : c'est vous qui répondez", tone: "" };
}

function headMarkup(conversation) {
  const name = contactName(conversation.contact);
  const phone = conversation.contact?.whatsappJid?.endsWith("@s.whatsapp.net") ? formatPhone(conversation.contact.whatsappJid) : "";
  const status = statusLine(conversation);
  return `
    <button type="button" class="btn-icon btn-ghost thread-back" id="thread-back" aria-label="Retour à la liste des conversations">${icon("arrow-left")}</button>
    ${avatarMarkup(conversation.contact?.displayName || "", { seed: conversation.contact?.whatsappJid || conversation.id })}
    <div class="thread-head-text">
      <h2 class="truncate">${escapeHtml(name)}</h2>
      <p class="truncate"><span class="thread-status ${status.tone}">${escapeHtml(status.text)}</span>${phone && conversation.contact?.displayName ? `<span class="thread-phone"> · ${escapeHtml(phone)}</span>` : ""}</p>
    </div>
    <div class="thread-head-actions">
      <label class="switch thread-ai" title="${conversation.aiEnabled ? "L'agent répond automatiquement à ce client. Désactivez-le pour répondre vous-même." : "L'agent est en pause pour ce client. Réactivez-le pour qu'il réponde à nouveau."}">
        <input type="checkbox" id="toggle-ai" ${conversation.aiEnabled ? "checked" : ""} aria-label="Agent IA actif pour ce client" />
        <span class="switch-track" aria-hidden="true"></span>
        <span class="switch-label">Agent IA</span>
      </label>
      <button type="button" class="btn-icon btn-ghost" id="toggle-info" aria-label="Afficher ou masquer la fiche du client" data-tip="Fiche du client" data-tip-pos="left">${icon("panel-right")}</button>
    </div>`;
}

function noticesMarkup(conversation) {
  const notices = [];
  if (conversation.paymentCheckPending) {
    notices.push(`
      <div class="alert warning payment-banner" role="alert">
        ${icon("receipt")}
        <div class="alert-body"><p class="alert-title">Le client a envoyé une preuve de paiement</p><p>L'agent ne peut pas la vérifier : contrôlez votre compte Mobile Money avant de livrer, puis marquez la commande « Payée » dans « Commandes ».</p></div>
        <div class="alert-actions"><button type="button" class="btn btn-sm btn-secondary" id="payment-checked">${icon("check")}J'ai vérifié</button></div>
      </div>`);
  }
  const resumeHint = autoResumeHint(conversation);
  if (resumeHint) notices.push(`<div class="alert neutral handoff-hint">${icon("clock")}<div class="alert-body">${escapeHtml(resumeHint)}</div></div>`);
  return notices.join("");
}

function stageOptions(conversation) {
  const options = STAGES.map((stage) => `<option value="${stage}"${conversation.stageLocked && conversation.stage === stage ? " selected" : ""}>${escapeHtml(STAGE_LABELS[stage])}</option>`);
  options.unshift(`<option value="AUTO"${conversation.stageLocked ? "" : " selected"}>Automatique : ${escapeHtml(STAGE_LABELS[conversation.stage] || conversation.stage)}</option>`);
  return options.join("");
}

function interestMarkup(conversation) {
  const score = Number(conversation.leadScore);
  if (!Number.isFinite(score) || score <= 0) return "";
  const level = score >= 75 ? { label: "Élevé", tone: "success" } : score >= 45 ? { label: "Moyen", tone: "warning" } : { label: "Faible", tone: "" };
  return `<div class="info-field"><span class="info-label">Intérêt estimé par l'agent</span><div class="interest"><div class="progress ${level.tone}"><span style="width:${Math.min(100, Math.round(score))}%"></span></div><b>${level.label}</b></div></div>`;
}

function leadDataMarkup(leadData) {
  const entries = Object.entries(leadData && typeof leadData === "object" ? leadData : {}).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
  if (!entries.length) return `<p class="info-empty">Rien pour le moment. L'agent note ici ce que le client lui indique (nom, quartier, besoin…).</p>`;
  return `<dl class="kv">${entries.map(([key, value]) => `<dt>${escapeHtml(LEAD_FIELD_LABELS[key] || key)}</dt><dd>${escapeHtml(String(value))}</dd>`).join("")}</dl>`;
}

function ordersMarkup(orders) {
  if (!orders?.length) return "";
  const rows = orders.map((order) => {
    const date = new Date(order.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const first = Array.isArray(order.items) && order.items[0]?.name ? order.items[0].name : "Commande";
    const more = Array.isArray(order.items) && order.items.length > 1 ? ` + ${order.items.length - 1}` : "";
    return `<button type="button" class="info-row" data-open-orders>
      <span class="info-row-main"><b class="truncate">${escapeHtml(first + more)}</b><small>${escapeHtml(date)}${order.total ? ` · ${escapeHtml(formatMoney(order.total))}` : ""}${order.status !== "CANCELLED" ? ` · ${order.paymentStatus === "PAID" ? "payée" : "à encaisser"}` : ""}</small></span>
      <span class="badge ${ORDER_STATUS_TONES[order.status] || "neutral"}">${escapeHtml(ORDER_STATUS_LABELS[order.status] || order.status)}</span>
    </button>`;
  }).join("");
  return `<section class="info-section"><h3>Commandes</h3><div class="info-rows">${rows}</div></section>`;
}

function appointmentsMarkup(appointments) {
  if (!appointments?.length) return "";
  const rows = appointments.map((appointment) => {
    const date = new Date(appointment.startsAt);
    const when = `${date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} à ${formatTime(date)}`;
    return `<button type="button" class="info-row" data-open-appointments>
      <span class="info-row-main"><b class="truncate">${escapeHtml(when)}</b><small class="truncate">${escapeHtml(appointment.service || "Rendez-vous")}</small></span>
      <span class="badge ${APPOINTMENT_STATUS_TONES[appointment.status] || "neutral"}">${escapeHtml(APPOINTMENT_STATUS_LABELS[appointment.status] || appointment.status)}</span>
    </button>`;
  }).join("");
  return `<section class="info-section"><h3>Rendez-vous</h3><div class="info-rows">${rows}</div></section>`;
}

/** Fiche du client : coordonnées, suivi, informations collectées, commandes, rendez-vous, préférences. */
function infoMarkup(conversation) {
  const name = contactName(conversation.contact);
  const isPhone = conversation.contact?.whatsappJid?.endsWith("@s.whatsapp.net");
  const digits = isPhone ? conversation.contact.whatsappJid.split("@")[0] : "";
  const phone = isPhone ? formatPhone(conversation.contact.whatsappJid) : "";
  const optedOut = Boolean(conversation.contact?.optedOut);
  const tags = [];
  if (conversation.startedFromAd) tags.push(`<span class="badge violet">${icon("megaphone")}Venu d'une publicité</span>`);
  if (optedOut) tags.push(`<span class="badge neutral">${icon("bell-off")}A écrit STOP</span>`);
  return `
    <header class="info-head">
      <span class="info-head-title">Fiche du client</span>
      <button type="button" class="btn-icon btn-sm btn-ghost" id="close-info" aria-label="Fermer la fiche du client">${icon("close", "icon-sm")}</button>
    </header>
    <div class="info-body">
      <section class="info-contact">
        ${avatarMarkup(conversation.contact?.displayName || "", { seed: conversation.contact?.whatsappJid || conversation.id, size: "xl" })}
        <h3 class="info-name">${escapeHtml(name)}</h3>
        ${phone && conversation.contact?.displayName ? `<p class="info-phone">${escapeHtml(phone)}</p>` : ""}
        ${tags.length ? `<div class="info-tags">${tags.join("")}</div>` : ""}
        ${digits ? `<div class="info-actions">
          <button type="button" class="btn btn-sm btn-secondary" id="copy-phone" data-phone="+${escapeHtml(digits)}">${icon("copy")}Copier le numéro</button>
          <a class="btn btn-sm btn-secondary" href="https://wa.me/${escapeHtml(digits)}" target="_blank" rel="noopener noreferrer">${icon("whatsapp")}WhatsApp</a>
        </div>` : ""}
      </section>

      <section class="info-section">
        <h3>Suivi</h3>
        <label class="info-field"><span class="info-label">Étape du client</span>
          <select id="stage-select" aria-label="Étape de suivi du client">${stageOptions(conversation)}</select>
        </label>
        ${interestMarkup(conversation)}
      </section>

      <section class="info-section"><h3>Informations collectées</h3>${leadDataMarkup(conversation.leadData)}</section>
      ${ordersMarkup(conversation.orders)}
      ${appointmentsMarkup(conversation.appointments)}

      <section class="info-section">
        <h3>Préférences</h3>
        <label class="switch info-switch">
          <input type="checkbox" id="toggle-optout" ${optedOut ? "checked" : ""} />
          <span class="switch-track" aria-hidden="true"></span>
          <span class="info-switch-text"><b>Ne plus relancer ce client</b><small>Il ne recevra ni relance automatique ni message groupé. Activé automatiquement s'il écrit STOP.</small></span>
        </label>
      </section>
    </div>`;
}

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function scrollThreadToEnd() {
  const thread = $("#detail-thread");
  if (thread) thread.scrollTop = thread.scrollHeight;
  $("#thread-new")?.classList.add("hidden");
}

/* ----------------------------------------- affichage liste ⇄ fil (téléphone) et fiche */

function infoPreference() {
  try {
    const stored = localStorage.getItem(INFO_KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

function setInfoOpen(open, { remember = true } = {}) {
  const panel = $("#conversation-detail");
  panel.classList.toggle("info-open", open);
  $("#toggle-info")?.setAttribute("aria-pressed", String(open));
  if (remember && isWide()) {
    try { localStorage.setItem(INFO_KEY, open ? "1" : "0"); } catch { /* préférence non mémorisée */ }
  }
}

/** Revient à la liste (téléphone) : la zone de réponse et les onglets du bas reprennent leur place. */
function showList() {
  document.body.classList.remove("in-thread");
  if (isCompact()) {
    selectedId = null;
    openedVersion = null;
    $$(".conversation-row").forEach((row) => row.classList.remove("active"));
  }
}

function closeThread() {
  showList();
  setRouteDetail("inbox", null, { replace: true });
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
}

/**
 * Ouvre (ou rafraîchit) une conversation. Au rafraîchissement automatique, on garde ce que l'utilisateur est en
 * train d'écrire et sa position dans le fil.
 */
export async function openConversation(id, { refresh = false, fromRoute = false } = {}) {
  try {
    const data = await api(`${orgBase()}/conversations/${id}`);
    const conversation = data.conversation;
    const detailPanel = $("#conversation-detail");
    const wasSelected = selectedId;
    selectedId = id;
    openedVersion = {
      lastMessageAt: (getState().conversations.find((item) => item.id === id) || {}).lastMessageAt ?? conversation.messages?.at(-1)?.createdAt,
      status: conversation.status,
      aiEnabled: conversation.aiEnabled,
      stage: conversation.stage,
      paymentCheckPending: conversation.paymentCheckPending,
    };

    const existingThread = $("#detail-thread");
    const keepForm = refresh && existingThread && detailPanel.dataset.conversation === id;
    const messageCount = conversation.messages?.length || 0;
    if (keepForm) {
      const stick = isNearBottom(existingThread);
      const previousScroll = existingThread.scrollTop;
      $("#detail-head").innerHTML = headMarkup(conversation);
      $("#detail-notices").innerHTML = noticesMarkup(conversation);
      existingThread.innerHTML = threadMarkup(conversation.messages);
      existingThread.scrollTop = stick ? existingThread.scrollHeight : previousScroll;
      if (!stick && messageCount > openedMessageCount) $("#thread-new")?.classList.remove("hidden");
      // La fiche n'est redessinée que si l'utilisateur n'est pas en train d'y choisir quelque chose.
      if (!$("#detail-info").contains(document.activeElement)) $("#detail-info").innerHTML = infoMarkup(conversation);
    } else {
      detailPanel.classList.add("has-conversation");
      detailPanel.dataset.conversation = id;
      detailPanel.innerHTML = `
        <div class="thread-main">
          <header id="detail-head" class="thread-head">${headMarkup(conversation)}</header>
          <div id="detail-notices" class="thread-notices">${noticesMarkup(conversation)}</div>
          <div class="thread-scroll">
            <div id="detail-thread" class="conversation-thread" tabindex="0" aria-label="Messages de la conversation">${threadMarkup(conversation.messages)}</div>
            <button type="button" class="thread-new hidden" id="thread-new">${icon("arrow-down", "icon-sm")}Nouveaux messages</button>
          </div>
          <form id="reply-form" class="reply-form">
            <div class="reply-box">
              <textarea required rows="1" maxlength="4000" placeholder="Écrire une réponse…" aria-label="Votre réponse au client" autocomplete="off"></textarea>
              <button type="submit" class="btn btn-primary btn-icon reply-send" aria-label="Envoyer la réponse">${icon("send")}</button>
            </div>
            <p class="reply-hint" id="reply-hint"></p>
          </form>
        </div>
        <aside id="detail-info" class="thread-info" aria-label="Fiche du client">${infoMarkup(conversation)}</aside>
      `;
      scrollThreadToEnd();
      const form = $("#reply-form");
      const textarea = form.querySelector("textarea");
      form.onsubmit = (event) => sendReply(event, id);
      textarea.addEventListener("input", () => autoGrow(textarea));
      textarea.addEventListener("keydown", (event) => {
        // Entrée envoie sur ordinateur ; sur téléphone elle passe à la ligne (le bouton envoie).
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && window.matchMedia("(hover: hover)").matches) {
          event.preventDefault();
          form.requestSubmit();
        }
      });
      $("#detail-thread").onclick = onThreadClick;
      $("#detail-thread").onscroll = () => { if (isNearBottom($("#detail-thread"))) $("#thread-new")?.classList.add("hidden"); };
      $("#thread-new").onclick = scrollThreadToEnd;
      setInfoOpen(isWide() ? infoPreference() : false, { remember: false });
    }
    openedMessageCount = messageCount;
    $("#reply-hint").textContent = conversation.aiEnabled
      ? "Votre réponse met l'agent en pause pour ce client. Il reprend seul après 24 h, ou dès que vous le réactivez."
      : "L'agent est en pause : c'est vous qui répondez à ce client.";
    bindHead(conversation);

    if (!refresh) {
      if (isCompact()) {
        document.body.classList.add("in-thread");
        // Le bouton « retour » du téléphone doit ramener à la liste : on ajoute une étape à l'historique.
        setRouteDetail("inbox", id, { replace: fromRoute || Boolean(wasSelected) });
      } else {
        setRouteDetail("inbox", id, { replace: true });
      }
    }

    if (!keepForm) {
      // Le fil vient d'être affiché (sur téléphone il était masqué jusqu'ici) : on se place sur les derniers messages,
      // et on y reste pendant le chargement des photos, tant que l'utilisateur n'a pas fait défiler lui-même.
      scrollThreadToEnd();
      const thread = $("#detail-thread");
      let pinned = true;
      const unpin = () => { pinned = false; };
      thread.addEventListener("wheel", unpin, { once: true, passive: true });
      thread.addEventListener("touchmove", unpin, { once: true, passive: true });
      $$("img", thread).forEach((image) => {
        if (!image.complete) image.addEventListener("load", () => { if (pinned) scrollThreadToEnd(); }, { once: true });
      });
    }

    $$(".conversation-row").forEach((row) => row.classList.toggle("active", row.dataset.id === id));
    if (getState().conversations.find((item) => item.id === id)?.unread) {
      await api(`${orgBase()}/conversations/${id}/read`, { method: "POST" }).catch(() => undefined);
      setState({ conversations: getState().conversations.map((item) => (item.id === id ? { ...item, unread: false } : item)) });
      updateBadges(getState().conversations);
      renderInbox();
    }
  } catch (error) {
    if (!refresh) showToast(error.message, "error");
  }
}

function bindHead(conversation) {
  const id = conversation.id;
  $("#toggle-ai").onchange = () => toggleAi(id, conversation.aiEnabled);
  $("#toggle-info").onclick = () => setInfoOpen(!$("#conversation-detail").classList.contains("info-open"));
  $("#toggle-info").setAttribute("aria-pressed", String($("#conversation-detail").classList.contains("info-open")));
  $("#thread-back").onclick = () => {
    // Si l'ouverture a ajouté une étape à l'historique, on la dépile ; sinon on revient simplement à la liste.
    if (readRoute().detail && window.history.state?.pushed) window.history.back();
    else closeThread();
  };
  const checked = $("#payment-checked");
  if (checked) checked.onclick = () => clearPaymentCheck(id);
  bindInfo(conversation);
}

function bindInfo(conversation) {
  const id = conversation.id;
  const stage = $("#stage-select");
  if (stage) stage.onchange = (event) => changeStage(id, event.target.value);
  const optOut = $("#toggle-optout");
  if (optOut) optOut.onchange = () => toggleOptOut(id, optOut.checked);
  const close = $("#close-info");
  if (close) close.onclick = () => setInfoOpen(false);
  const copy = $("#copy-phone");
  if (copy) copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(copy.dataset.phone);
      showToast("Numéro copié.", "success");
    } catch {
      showToast(`Numéro : ${copy.dataset.phone}`, "info");
    }
  };
  $$("[data-open-orders]", $("#detail-info")).forEach((button) => { button.onclick = () => $('.nav-item[data-view="orders"]')?.click(); });
  $$("[data-open-appointments]", $("#detail-info")).forEach((button) => { button.onclick = () => $('.nav-item[data-view="appointments"]')?.click(); });
}

async function sendReply(event, id) {
  event.preventDefault();
  const input = event.target.querySelector("textarea");
  const button = event.target.querySelector('button[type="submit"]');
  const text = input.value.trim();
  if (!text) return;
  button.disabled = true;
  button.classList.add("is-loading");

  try {
    await api(`${orgBase()}/conversations/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    input.value = "";
    autoGrow(input);
    await refreshAndReopen(id);
    scrollThreadToEnd();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
  }
}

async function toggleAi(id, enabled) {
  try {
    await api(`${orgBase()}/conversations/${id}/ai/${enabled ? "disable" : "enable"}`, { method: "POST" });
    showToast(enabled ? "Agent mis en pause pour ce client." : "Agent réactivé pour ce client.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
  await refreshAndReopen(id);
}

async function changeStage(id, stage) {
  try {
    await api(`${orgBase()}/conversations/${id}/stage`, { method: "POST", body: JSON.stringify({ stage }) });
    showToast(stage === "AUTO" ? "L'agent choisit de nouveau l'étape." : `Étape : ${STAGE_LABELS[stage]}`, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
  $("#stage-select")?.blur();
  await refreshAndReopen(id);
}

async function toggleOptOut(id, optedOut) {
  try {
    await api(`${orgBase()}/conversations/${id}/opt-out`, { method: "POST", body: JSON.stringify({ optedOut }) });
    showToast(optedOut ? "Ce client ne recevra plus de relances ni de messages groupés." : "Ce client peut de nouveau recevoir des relances.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
  $("#toggle-optout")?.blur();
  await refreshAndReopen(id);
}

async function clearPaymentCheck(id) {
  try {
    await api(`${orgBase()}/conversations/${id}/payment-check`, { method: "POST", body: JSON.stringify({ pending: false }) });
    await refreshAndReopen(id);
  } catch (error) {
    showToast(error.message, "error");
  }
}

/* ------------------------------------------- clics dans le fil (photos, corrections) */

function openLightbox(url) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Photo envoyée par le client");
  overlay.innerHTML = `<img src="${escapeHtml(url)}" alt="Photo envoyée par le client" /><button type="button" class="btn-icon lightbox-close" aria-label="Fermer">${icon("close")}</button>`;
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  overlay.onclick = close;
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  overlay.querySelector("button").focus();
}

function onThreadClick(event) {
  const thumb = event.target.closest("[data-lightbox]");
  if (thumb) return openLightbox(thumb.dataset.lightbox);
  const correct = event.target.closest("[data-correct]");
  if (correct) return openCorrectionForm(correct);
}

function openCorrectionForm(button) {
  const message = button.closest(".msg");
  const messageId = button.dataset.correct;
  const original = message.querySelector(".bubble-text")?.textContent || "";
  const body = button.closest(".why-body");
  body.innerHTML = `
    <form class="correction-form">
      <label class="field"><span class="field-label">Qu'aurait-il fallu répondre ?</span>
        <textarea required maxlength="1000" rows="4">${escapeHtml(original)}</textarea>
      </label>
      <label class="checkbox-row correction-general"><input type="checkbox" /><span>Règle générale (à appliquer quelle que soit la question)</span></label>
      <p class="hint">L'agent s'en souviendra pour les questions de ce type. Vous pourrez retirer cette correction dans « Agent IA ».</p>
      <div class="correction-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-sm btn-primary">Enregistrer la correction</button>
      </div>
    </form>`;
  const form = body.querySelector("form");
  body.querySelector("[data-cancel]").onclick = () => openConversation(selectedId, { refresh: true });
  form.onsubmit = async (submitEvent) => {
    submitEvent.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api(`${orgBase()}/conversations/${selectedId}/messages/${messageId}/correct`, {
        method: "POST",
        body: JSON.stringify({ correctReply: form.querySelector("textarea").value, general: form.querySelector('input[type="checkbox"]').checked }),
      });
      showToast("Noté. L'agent s'en souviendra.", "success");
      await openConversation(selectedId, { refresh: true });
    } catch (error) {
      submit.disabled = false;
      showToast(error.message, "error");
    }
  };
  form.querySelector("textarea").focus();
}

/* ------------------------------------------------------------- câblage */

/** Permet à app.js d'injecter le refresh global sans dépendance circulaire. */
export function bindInboxRefresh(callback) {
  refreshCallback = callback;
}

async function refreshAndReopen(id) {
  await refreshCallback();
  await loadInbox({ silent: true });
  if (selectedId === id) await openConversation(id, { refresh: true });
}

/** Rafraîchit tout seul : la page Conversations toutes les 8 s, le compteur des autres pages plus rarement. */
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.hidden || !getState().organizationId || !document.querySelector(".app-shell:not(.hidden)")) return;
    tick += 1;
    if (isInboxVisible() || tick % BACKGROUND_EVERY_N_TICKS === 0) void loadInbox({ silent: true });
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && getState().organizationId && document.querySelector(".app-shell:not(.hidden)")) void loadInbox({ silent: true });
  });
}

export function initInbox() {
  $("#inbox-search").addEventListener("input", debounce((event) => {
    searchText = event.target.value;
    renderInbox();
  }, 120));
  // Bouton « retour » du navigateur ou du téléphone : sans conversation dans l'adresse, on revient à la liste.
  document.addEventListener("brayano:route", (event) => {
    if (event.detail.view !== "inbox") return;
    if (!event.detail.detail) showList();
    else if (event.detail.detail !== selectedId) void openConversation(event.detail.detail, { fromRoute: true });
  });
  startPolling();
}
