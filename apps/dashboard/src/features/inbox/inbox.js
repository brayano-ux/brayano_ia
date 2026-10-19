import { api } from "../../services/api.js";
import { getApiBaseUrl } from "../../config.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { formatDateTime } from "../../utils/format.js";
import { describeAiMeta, STAGES, STAGE_LABELS } from "../../utils/labels.js";
import { getState, setState } from "../../state/store.js";
import { conversationMarkup, bindConversationRows } from "./conversation-item.js";

/**
 * Boîte de réception : liste légère (dernier message seulement) mise à jour toute seule, étiquettes de suivi,
 * fil de discussion avec photos et documents reçus, journal « pourquoi cette réponse ? » et correction de l'assistant.
 */

const POLL_MS = 8000;
/** Hors de la boîte de réception, on rafraîchit seulement le compteur : un tick sur 4. */
const BACKGROUND_EVERY_N_TICKS = 4;

let stageFilter = "";
let searchText = "";
let selectedId = null;
let openedVersion = null;
let pollTimer = null;
let tick = 0;
let listSignature = "";
const seenIncoming = new Map();
let firstListLoaded = false;
let refreshCallback = async () => {};

const orgBase = () => `/organizations/${getState().organizationId}`;

function isInboxVisible() {
  const view = $("#inbox-view");
  return Boolean(view) && !view.classList.contains("hidden");
}

function contactName(contact) {
  return contact?.displayName || contact?.whatsappJid?.split("@")[0] || "Contact";
}

/* ----------------------------------------------------------------- liste */

/** Conversation qui attend une action du propriétaire. */
export function needsAttention(item) {
  return Boolean(item.unread || item.status === "HUMAN_HANDOFF" || item.stage === "CALLBACK" || item.paymentCheckPending);
}

function filteredConversations() {
  const needle = searchText.trim().toLowerCase();
  return getState().conversations.filter((item) => {
    if (stageFilter === "TO_HANDLE") return needsAttention(item);
    if (stageFilter && item.stage !== stageFilter) return false;
    if (!needle) return true;
    const haystack = `${contactName(item.contact)} ${item.contact?.whatsappJid || ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}

function renderStageFilters() {
  const { conversations } = getState();
  const toHandle = conversations.filter(needsAttention).length;
  const counts = Object.fromEntries(STAGES.map((stage) => [stage, conversations.filter((item) => item.stage === stage).length]));
  const chips = [
    { value: "", label: "Toutes", count: conversations.length },
    { value: "TO_HANDLE", label: "À traiter", count: toHandle },
    ...STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage], count: counts[stage] })),
  ];
  $("#inbox-stage-filters").innerHTML = chips
    .map((chip) => `<button type="button" class="stage-filter${chip.value === stageFilter ? " active" : ""}" data-stage-filter="${chip.value}" role="tab" aria-selected="${chip.value === stageFilter}">${escapeHtml(chip.label)} <b>${chip.count}</b></button>`)
    .join("");
  $$("[data-stage-filter]", $("#inbox-stage-filters")).forEach((button) => {
    button.onclick = () => {
      stageFilter = button.dataset.stageFilter;
      renderInbox();
    };
  });
}

export function renderInbox() {
  const all = getState().conversations;
  const visible = filteredConversations();
  $("#inbox-total").textContent = `${visible.length} conversation${visible.length > 1 ? "s" : ""}`;
  renderStageFilters();
  const target = $("#all-conversations");
  const scrollTop = target.scrollTop;
  target.innerHTML = visible.length
    ? visible.map(conversationMarkup).join("")
    : `<div class="empty-state">${all.length ? "Aucune conversation ne correspond." : "Aucune conversation pour le moment."}</div>`;
  target.scrollTop = scrollTop;
  bindConversationRows(target, openConversation);
  if (selectedId) $$(".conversation-row", target).forEach((row) => row.classList.toggle("active", row.dataset.id === selectedId));
}

function signatureOf(conversations) {
  return conversations
    .map((item) => `${item.id}|${item.lastMessageAt}|${item.status}|${item.aiEnabled}|${item.stage}|${item.unread}|${item.paymentCheckPending}|${item.messageCount}`)
    .join(";");
}

export function updateBadges(conversations) {
  const unread = conversations.filter((item) => item.unread).length;
  const badge = $("#nav-count");
  if (badge) {
    badge.textContent = unread;
    badge.classList.toggle("is-zero", unread === 0);
    badge.title = unread ? `${unread} conversation${unread > 1 ? "s" : ""} avec un nouveau message` : "Aucun nouveau message";
  }
  document.title = `${unread ? `(${unread}) ` : ""}Brayano AI — Centre de pilotage`;
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

function conversationDetailStatusLabel(conversation) {
  if (conversation.status === "CLOSED") return "Conversation fermée";
  if (conversation.status === "HUMAN_HANDOFF") return "En attente d'une personne";
  return conversation.aiEnabled ? "Agent IA actif" : "Prise en main humaine";
}

/**
 * Pendant une prise en main humaine, l'IA reprend seule 24 h après, au prochain message du
 * prospect. Ce délai est une simple information : le bouton « Réactiver l'IA » reste toujours actif.
 */
function autoResumeHint(conversation) {
  if (conversation.status !== "HUMAN_HANDOFF" || conversation.aiEnabled) return "";

  const remainingMs = new Date(conversation.updatedAt).getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (remainingMs <= 0) return "L'IA reprendra dès le prochain message du client.";

  const remainingMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return `Sans action de votre part, l'IA reprend dans ${hours} h ${minutes} min (au prochain message du client).`;
}

function mediaMarkup(message) {
  if (message.type !== "IMAGE" && message.type !== "DOCUMENT") return "";
  if (!message.mediaUrl) {
    return `<span class="media-missing">${message.type === "IMAGE" ? "📷 Photo reçue (plus conservée)" : "📎 Document reçu (plus conservé)"}</span>`;
  }
  const url = `${getApiBaseUrl()}${message.mediaUrl}`;
  if (message.type === "IMAGE") {
    return `<button type="button" class="media-thumb" data-lightbox="${escapeHtml(url)}" aria-label="Voir la photo en grand"><img src="${escapeHtml(url)}" alt="Photo envoyée par le client" loading="lazy" /></button>`;
  }
  return `<a class="media-file" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" download>📎 ${escapeHtml(message.mediaName || "Document")} <small>Télécharger</small></a>`;
}

function whyMarkup(message) {
  const lines = describeAiMeta(message.aiMeta);
  if (!lines.length || message.author !== "AI") return "";
  const canCorrect = !message.aiMeta?.kind;
  return `
    <details class="why">
      <summary>Pourquoi cette réponse ?</summary>
      <div class="why-body">
        <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        ${canCorrect ? `<button type="button" class="text-button" data-correct="${escapeHtml(message.id)}">✏️ Corriger cette réponse</button>` : ""}
      </div>
    </details>`;
}

function senderLabel(message) {
  if (message.aiMeta?.kind === "broadcast") return "📣 Message groupé";
  if (message.author === "HUMAN") return message.aiMeta?.sentBy ? `Envoyé par ${message.aiMeta.sentBy}` : "Vous";
  if (message.aiMeta?.kind === "follow_up") return "🔔 Relance automatique";
  return "";
}

function messageBubbleMarkup(message) {
  const isFromContact = message.author === "CONTACT";
  const label = senderLabel(message);
  const text = message.type === "IMAGE" || message.type === "DOCUMENT"
    ? (/^\[(Photo|Document) reçu/.test(message.content) ? "" : message.content)
    : message.content;
  return `
    <div class="thread-bubble ${isFromContact ? "from-contact" : message.author === "AI" ? "from-agent" : "from-human"}" data-message-id="${escapeHtml(message.id)}">
      ${label ? `<small class="bubble-label">${escapeHtml(label)}</small>` : ""}
      ${mediaMarkup(message)}
      ${text ? `<span>${escapeHtml(text)}</span>` : ""}
      <time>${formatDateTime(message.createdAt)}</time>
      ${whyMarkup(message)}
    </div>
  `;
}

function stageOptions(conversation) {
  const options = STAGES.map((stage) => `<option value="${stage}"${conversation.stage === stage ? " selected" : ""}>${escapeHtml(STAGE_LABELS[stage])}</option>`);
  options.push(`<option value="AUTO"${conversation.stageLocked ? "" : " selected"}>Automatique (${escapeHtml(STAGE_LABELS[conversation.stage] || conversation.stage)})</option>`);
  return options.join("");
}

function headMarkup(conversation) {
  const name = contactName(conversation.contact);
  const phone = conversation.contact?.whatsappJid?.endsWith("@s.whatsapp.net") ? `+${conversation.contact.whatsappJid.split("@")[0]}` : "";
  const resumeHint = autoResumeHint(conversation);
  const optedOut = Boolean(conversation.contact?.optedOut);
  return `
    <div class="panel-heading">
      <div>
        <h2>${escapeHtml(name)}</h2>
        <p class="muted">${escapeHtml(phone)}${phone ? " · " : ""}${escapeHtml(conversationDetailStatusLabel(conversation))}</p>
        ${resumeHint ? `<p class="muted handoff-hint">${escapeHtml(resumeHint)}</p>` : ""}
      </div>
      <button class="ghost-button" id="toggle-ai" type="button">${conversation.aiEnabled ? "Désactiver l'IA" : "Réactiver l'IA"}</button>
    </div>
    <div class="detail-tools">
      <label class="stage-select">
        <span>Étiquette</span>
        <select id="stage-select" aria-label="Étiquette de suivi du client">${stageOptions(conversation)}</select>
      </label>
      <button type="button" class="text-button" id="toggle-optout" title="Un client qui a écrit STOP, ou que vous ne voulez plus relancer, ne reçoit ni relance ni message groupé.">${optedOut ? "🔕 Ne reçoit plus de relances — réactiver" : "🔕 Ne plus relancer ce client"}</button>
    </div>
    ${conversation.paymentCheckPending ? `
      <div class="payment-banner" role="alert">
        <span>💳 <strong>Le client a envoyé une preuve de paiement.</strong> L'assistant ne peut pas la vérifier : contrôlez votre compte Mobile Money avant de livrer, puis marquez la commande « Payée » dans l'onglet Commandes.</span>
        <button type="button" class="ghost-button" id="payment-checked">J'ai vérifié</button>
      </div>` : ""}
  `;
}

function threadMarkup(messages) {
  return (messages || []).map(messageBubbleMarkup).join("") || '<div class="empty-state">Aucun message.</div>';
}

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

/**
 * Ouvre (ou rafraîchit) une conversation. Au rafraîchissement automatique, on garde ce que le propriétaire est en train
 * d'écrire et sa position dans le fil.
 */
export async function openConversation(id, { refresh = false } = {}) {
  try {
    const data = await api(`${orgBase()}/conversations/${id}`);
    const conversation = data.conversation;
    const detailPanel = $("#conversation-detail");
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
    if (keepForm) {
      const stick = isNearBottom(existingThread);
      const previousScroll = existingThread.scrollTop;
      $("#detail-head").innerHTML = headMarkup(conversation);
      existingThread.innerHTML = threadMarkup(conversation.messages);
      existingThread.scrollTop = stick ? existingThread.scrollHeight : previousScroll;
    } else {
      detailPanel.classList.add("has-conversation");
      detailPanel.dataset.conversation = id;
      detailPanel.innerHTML = `
        <div id="detail-head" class="detail-head">${headMarkup(conversation)}</div>
        <div id="detail-thread" class="conversation-thread">${threadMarkup(conversation.messages)}</div>
        <form id="reply-form" class="reply-form">
          <input required placeholder="Écrire une réponse..." autocomplete="off" />
          <button class="primary">Envoyer</button>
        </form>
      `;
      $("#detail-thread").scrollTop = $("#detail-thread").scrollHeight;
      $("#reply-form").onsubmit = (event) => sendReply(event, id);
      $("#detail-thread").onclick = onThreadClick;
      if (window.innerWidth < 1100 && !refresh) detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    bindHead(conversation);

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
  $("#toggle-ai").onclick = () => toggleAi(id, conversation.aiEnabled);
  $("#stage-select").onchange = (event) => changeStage(id, event.target.value);
  $("#toggle-optout").onclick = () => toggleOptOut(id, !conversation.contact?.optedOut);
  const checked = $("#payment-checked");
  if (checked) checked.onclick = () => clearPaymentCheck(id);
}

async function sendReply(event, id) {
  event.preventDefault();
  const input = event.target.querySelector("input");
  const button = event.target.querySelector("button");
  button.disabled = true;

  try {
    await api(`${orgBase()}/conversations/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ text: input.value }),
    });
    input.value = "";
    showToast("Réponse envoyée", "success");
    await refreshAndReopen(id);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function toggleAi(id, enabled) {
  try {
    await api(`${orgBase()}/conversations/${id}/ai/${enabled ? "disable" : "enable"}`, { method: "POST" });
    showToast(enabled ? "IA désactivée" : "IA réactivée", "success");
    await refreshAndReopen(id);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function changeStage(id, stage) {
  try {
    await api(`${orgBase()}/conversations/${id}/stage`, { method: "POST", body: JSON.stringify({ stage }) });
    showToast(stage === "AUTO" ? "L'assistant gère l'étiquette." : `Étiquette : ${STAGE_LABELS[stage]}`, "success");
    await refreshAndReopen(id);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function toggleOptOut(id, optedOut) {
  try {
    await api(`${orgBase()}/conversations/${id}/opt-out`, { method: "POST", body: JSON.stringify({ optedOut }) });
    showToast(optedOut ? "Ce client ne recevra plus de relances ni de messages groupés." : "Ce client peut de nouveau recevoir des relances.", "success");
    await refreshAndReopen(id);
  } catch (error) {
    showToast(error.message, "error");
  }
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
  overlay.innerHTML = `<img src="${escapeHtml(url)}" alt="Photo envoyée par le client" /><button type="button" class="lightbox-close" aria-label="Fermer">×</button>`;
  const close = () => overlay.remove();
  overlay.onclick = close;
  document.addEventListener("keydown", function onKey(event) {
    if (event.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKey);
    }
  });
  document.body.appendChild(overlay);
}

function onThreadClick(event) {
  const thumb = event.target.closest("[data-lightbox]");
  if (thumb) return openLightbox(thumb.dataset.lightbox);
  const correct = event.target.closest("[data-correct]");
  if (correct) return openCorrectionForm(correct);
}

function openCorrectionForm(button) {
  const bubble = button.closest(".thread-bubble");
  const messageId = button.dataset.correct;
  const original = bubble.querySelector("span")?.textContent || "";
  const body = button.closest(".why-body");
  body.innerHTML = `
    <form class="correction-form">
      <label>Qu'aurait-il fallu répondre ?
        <textarea required maxlength="1000" rows="4">${escapeHtml(original)}</textarea>
      </label>
      <label class="correction-general"><input type="checkbox" /> Règle générale (à appliquer quelle que soit la question)</label>
      <p class="muted">L'assistant s'en souviendra pour les questions de ce type. Vous pourrez la retirer dans « Agent IA ».</p>
      <div class="correction-actions">
        <button type="submit" class="primary">Enregistrer la correction</button>
        <button type="button" class="ghost-button" data-cancel>Annuler</button>
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
      showToast("Noté. L'assistant s'en souviendra.", "success");
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
  await openConversation(id, { refresh: true });
}

/** Rafraîchit tout seul : la boîte de réception toutes les 8 s, le compteur des autres pages plus rarement. */
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.hidden || !getState().organizationId || !document.querySelector(".app-shell:not(.hidden)")) return;
    tick += 1;
    if (isInboxVisible() || tick % BACKGROUND_EVERY_N_TICKS === 0) void loadInbox({ silent: true });
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && getState().organizationId) void loadInbox({ silent: true });
  });
}

export function initInbox() {
  $("#inbox-search").addEventListener("input", (event) => {
    searchText = event.target.value;
    renderInbox();
  });
  startPolling();
}
