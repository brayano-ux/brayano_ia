import { api } from "../../services/api.js";
import { $, $$, debounce, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { formatMoney, formatNumber, formatPhone } from "../../utils/format.js";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from "../../utils/labels.js";
import { avatarMarkup } from "../../ui/avatar.js";
import { confirmDialog } from "../../ui/confirm.js";
import { icon } from "../../ui/icons.js";

/**
 * Commandes : résumé (à confirmer, à encaisser, ventes), filtres par statut, et pour chaque commande
 * les actions utiles au bon moment (confirmer, marquer livrée, enregistrer le paiement).
 */

const PAYMENT_METHODS = ["Orange Money", "MTN MoMo", "Espèces", "Virement", "Autre"];

let orders = [];
let filter = "";
let searchText = "";
let payingId = null;

const base = () => `/organizations/${getState().organizationId}/orders`;
const normalize = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function nextActions(order) {
  if (order.status === "NEW") return [["CONFIRMED", "Confirmer la commande", "check", "btn-primary"], ["CANCELLED", "Annuler", "close", "btn-ghost btn-danger-ghost"]];
  if (order.status === "CONFIRMED") return [["DELIVERED", "Marquer comme livrée", "truck", "btn-primary"], ["CANCELLED", "Annuler", "close", "btn-ghost btn-danger-ghost"]];
  return [];
}

function matchesFilter(order, value) {
  if (!value) return true;
  if (value === "UNPAID") return order.paymentStatus === "UNPAID" && order.status !== "CANCELLED";
  return order.status === value;
}

function matchesSearch(order) {
  const needle = normalize(searchText.trim());
  if (!needle) return true;
  const items = (Array.isArray(order.items) ? order.items : []).map((item) => item.name).join(" ");
  return normalize(`${order.customerName} ${order.customerPhone || ""} ${order.deliveryAddress || ""} ${items}`).includes(needle);
}

function paymentMarkup(order) {
  if (order.status === "CANCELLED") return "";
  if (order.paymentStatus === "PAID") {
    const detail = [order.paymentMethod, order.paymentNote].filter(Boolean).join(" · ");
    return `<div class="payment-line paid">${icon("check-circle", "icon-sm")}<span><b>Payée</b>${detail ? ` · ${escapeHtml(detail)}` : ""}</span><button type="button" class="btn btn-sm btn-ghost" data-unpay="${escapeHtml(order.id)}">Annuler le paiement</button></div>`;
  }
  if (payingId === order.id) {
    return `
      <form class="payment-form" data-pay-form="${escapeHtml(order.id)}">
        <label class="field"><span class="field-label">Moyen de paiement</span><select>${PAYMENT_METHODS.map((method) => `<option>${escapeHtml(method)}</option>`).join("")}</select></label>
        <label class="field"><span class="field-label">Référence ou note <span class="optional">facultatif</span></span><input type="text" maxlength="200" placeholder="Ex. numéro de transaction" /></label>
        <div class="payment-form-actions"><button type="button" class="btn btn-ghost" data-pay-cancel>Annuler</button><button type="submit" class="btn btn-primary">${icon("check")}Enregistrer le paiement</button></div>
      </form>`;
  }
  return `
    <div class="payment-line unpaid${order.proofReceived ? " proof" : ""}">
      ${icon(order.proofReceived ? "receipt" : "hourglass", "icon-sm")}
      <span>${order.proofReceived ? "<b>Preuve de paiement reçue</b> · vérifiez votre compte Mobile Money avant de valider" : "Paiement en attente"}</span>
      <button type="button" class="btn btn-sm btn-secondary" data-pay="${escapeHtml(order.id)}">${icon("banknote")}Marquer payée</button>
    </div>`;
}

function orderMarkup(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const phone = order.customerPhone ? formatPhone(order.customerPhone) : "";
  const actions = nextActions(order);
  return `
    <article class="card order-card status-${escapeHtml(String(order.status).toLowerCase())}">
      <header class="order-card-head">
        ${avatarMarkup(order.customerName, { seed: order.customerPhone || order.customerName })}
        <div class="order-card-who">
          <strong class="truncate">${escapeHtml(order.customerName)}</strong>
          <small class="truncate">${escapeHtml(phone)}${phone ? " · " : ""}${escapeHtml(formatDate(order.createdAt))}</small>
        </div>
        <span class="badge ${ORDER_STATUS_TONES[order.status] || "neutral"}">${escapeHtml(ORDER_STATUS_LABELS[order.status] || order.status)}</span>
        <strong class="order-total num">${order.total !== null && order.total !== undefined ? escapeHtml(formatMoney(order.total)) : "Total à confirmer"}</strong>
      </header>
      <div class="order-card-body">
        <ul class="order-items">
          ${items.map((item) => `<li><span class="order-qty num">${escapeHtml(item.quantity)} ×</span><span class="order-item-name">${escapeHtml(item.name)}</span><small>${escapeHtml(item.unitPrice || "")}</small></li>`).join("")}
        </ul>
        <div class="order-facts">
          <p class="order-fact">${icon("map-pin", "icon-sm")}<span>${escapeHtml(order.deliveryAddress)}</span></p>
          ${order.notes ? `<p class="order-fact">${icon("sticky-note", "icon-sm")}<span>${escapeHtml(order.notes)}</span></p>` : ""}
        </div>
      </div>
      ${paymentMarkup(order)}
      ${actions.length || order.conversationId ? `<footer class="order-card-foot">
        ${order.conversationId ? `<button type="button" class="btn btn-sm btn-ghost" data-open-conversation="${escapeHtml(order.conversationId)}">${icon("chats")}Voir la conversation</button>` : "<span></span>"}
        <div class="order-actions">
          ${actions.map(([status, label, iconName, className]) => `<button type="button" class="btn btn-sm ${className}" data-order="${escapeHtml(order.id)}" data-status="${status}">${icon(iconName)}${label}</button>`).join("")}
        </div>
      </footer>` : ""}
    </article>`;
}

function renderSummary() {
  const active = orders.filter((order) => order.status !== "CANCELLED");
  const fresh = orders.filter((order) => order.status === "NEW");
  const unpaid = active.filter((order) => order.paymentStatus === "UNPAID");
  const unpaidAmount = unpaid.reduce((sum, order) => sum + (order.total || 0), 0);
  const paidAmount = active.filter((order) => order.paymentStatus === "PAID").reduce((sum, order) => sum + (order.total || 0), 0);
  const tile = (iconName, tone, label, value, hint, target) => `
    <button type="button" class="card summary-tile" data-summary-filter="${target}">
      <span class="icon-tile ${tone}">${icon(iconName)}</span>
      <span class="summary-text"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(hint)}</span></span>
    </button>`;
  $("#orders-summary").innerHTML = orders.length ? [
    tile("bag", "primary-tile", "À confirmer", formatNumber(fresh.length), fresh.length ? "nouvelles commandes" : "aucune nouvelle commande", "NEW"),
    tile("hourglass", "warning", "À encaisser", formatMoney(unpaidAmount), `${formatNumber(unpaid.length)} commande${unpaid.length > 1 ? "s" : ""} en attente de paiement`, "UNPAID"),
    tile("banknote", "success", "Encaissé", formatMoney(paidAmount), "sur les commandes affichées ici", ""),
  ].join("") : "";
  $$("[data-summary-filter]").forEach((button) => {
    button.onclick = () => {
      setOrdersFilter(button.dataset.summaryFilter);
      renderOrders();
    };
  });
}

function renderOrders() {
  const container = $("#orders-list");
  const visible = orders.filter((order) => matchesFilter(order, filter) && matchesSearch(order));
  $("#orders-count").textContent = `${formatNumber(visible.length)} commande${visible.length === 1 ? "" : "s"}`;
  $$(".orders-filter").forEach((button) => {
    const count = orders.filter((order) => matchesFilter(order, button.dataset.filter || "")).length;
    const badge = button.querySelector(".chip-count");
    if (badge) badge.textContent = String(count);
    const active = (button.dataset.filter || "") === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $(".orders-toolbar").classList.toggle("hidden", !orders.length);
  renderSummary();

  if (!orders.length) {
    container.innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon("bag")}</span><p class="empty-title">Aucune commande pour le moment</p><p class="empty-text">Dès qu'un client confirmera un achat sur WhatsApp, votre agent enregistrera la commande ici, avec l'article, la quantité et l'adresse de livraison.</p></div></div>`;
    return;
  }
  if (!visible.length) {
    container.innerHTML = `<div class="card"><div class="empty empty-compact"><span class="empty-icon">${icon("search")}</span><p class="empty-title">Aucune commande trouvée</p><p class="empty-text">Aucune commande ne correspond à ce filtre ou à cette recherche.</p><button type="button" class="btn btn-secondary btn-sm" id="orders-clear">Tout afficher</button></div></div>`;
    $("#orders-clear").onclick = () => {
      searchText = "";
      $("#orders-search").value = "";
      setOrdersFilter("");
      renderOrders();
    };
    return;
  }

  container.innerHTML = visible.map(orderMarkup).join("");

  $$("[data-order]", container).forEach((button) => {
    button.onclick = () => changeStatus(button.dataset.order, button.dataset.status);
  });
  $$("[data-pay]", container).forEach((button) => {
    button.onclick = () => {
      payingId = button.dataset.pay;
      renderOrders();
      $(`[data-pay-form="${payingId}"] select`)?.focus();
    };
  });
  $$("[data-pay-cancel]", container).forEach((button) => {
    button.onclick = () => {
      payingId = null;
      renderOrders();
    };
  });
  $$("[data-pay-form]", container).forEach((form) => {
    form.onsubmit = (event) => {
      event.preventDefault();
      void setPayment(form.dataset.payForm, { paymentStatus: "PAID", paymentMethod: form.querySelector("select").value, paymentNote: form.querySelector("input").value.trim() || undefined });
    };
  });
  $$("[data-unpay]", container).forEach((button) => {
    button.onclick = async () => {
      const confirmed = await confirmDialog({ title: "Annuler ce paiement ?", message: "La commande repassera en « paiement en attente ».", confirmLabel: "Annuler le paiement", cancelLabel: "Garder le paiement", tone: "danger" });
      if (confirmed) void setPayment(button.dataset.unpay, { paymentStatus: "UNPAID" });
    };
  });
  $$("[data-open-conversation]", container).forEach((button) => {
    button.onclick = () => document.dispatchEvent(new CustomEvent("brayano:open-conversation", { detail: { id: button.dataset.openConversation } }));
  });
}

async function setPayment(id, body) {
  try {
    await api(`${base()}/${id}/payment`, { method: "PUT", body: JSON.stringify(body) });
    payingId = null;
    showToast(body.paymentStatus === "PAID" ? "Paiement enregistré." : "Paiement remis en attente.", "success");
    await loadOrders();
  } catch (error) {
    showToast(error.message || "Mise à jour impossible.", "error");
  }
}

async function changeStatus(id, status) {
  if (status === "CANCELLED") {
    const order = orders.find((entry) => entry.id === id);
    const confirmed = await confirmDialog({ title: "Annuler cette commande ?", message: `La commande de ${order?.customerName || "ce client"} sera marquée comme annulée. Pensez à prévenir le client.`, confirmLabel: "Annuler la commande", cancelLabel: "Garder la commande", tone: "danger" });
    if (!confirmed) return;
  }
  try {
    await api(`${base()}/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    showToast(status === "CONFIRMED" ? "Commande confirmée." : status === "DELIVERED" ? "Commande marquée comme livrée." : "Commande annulée.", "success");
    await loadOrders();
  } catch (error) {
    showToast(error.message || "Mise à jour impossible.", "error");
  }
}

/** Pastilles du menu et de la barre d'onglets : nombre de nouvelles commandes à confirmer. */
function updateOrderBadges() {
  const fresh = orders.filter((order) => order.status === "NEW").length;
  for (const selector of ["#nav-orders-count", "#tab-orders-count"]) {
    const badge = $(selector);
    if (!badge) continue;
    badge.textContent = String(fresh);
    badge.classList.toggle("hidden", fresh === 0);
  }
}

export async function loadOrders() {
  if (!getState().organizationId) return;
  try {
    const [settings, list] = await Promise.all([api(`${base()}/settings`), api(base())]);
    $("#orders-enabled").checked = Boolean(settings.settings.enabled);
    orders = list.orders;
    updateOrderBadges();
    renderOrders();
  } catch (error) {
    $("#orders-list").innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon("alert")}</span><p class="empty-title">Commandes indisponibles</p><p class="empty-text">${escapeHtml(error.message || "Impossible de charger les commandes.")}</p></div></div>`;
  }
}

/** Présélectionne un filtre (« NEW », « UNPAID »…) avant d'afficher la liste. */
export function setOrdersFilter(value) {
  filter = value || "";
  payingId = null;
}

export function initOrders() {
  $("#orders-enabled").addEventListener("change", async (event) => {
    const input = event.currentTarget;
    try {
      await api(`${base()}/settings`, { method: "PUT", body: JSON.stringify({ enabled: input.checked }) });
      showToast(input.checked ? "Prise de commande activée." : "Prise de commande désactivée.", "success");
    } catch (error) {
      input.checked = !input.checked;
      showToast(error.message || "Impossible d’enregistrer le réglage.", "error");
    }
  });

  $$(".orders-filter").forEach((button) => {
    button.onclick = () => {
      setOrdersFilter(button.dataset.filter);
      renderOrders();
    };
  });
  $("#orders-search").addEventListener("input", debounce((event) => {
    searchText = event.target.value;
    renderOrders();
  }, 120));
}
