import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";

const STATUS_LABELS = { NEW: "Nouvelle", CONFIRMED: "Confirmée", DELIVERED: "Livrée", CANCELLED: "Annulée" };

const PAYMENT_METHODS = ["Orange Money", "MTN MoMo", "Espèces", "Virement", "Autre"];

let orders = [];
let filter = "";
let payingId = null;

const base = () => `/organizations/${getState().organizationId}/orders`;

function formatMoney(value) {
  return `${new Intl.NumberFormat("fr-FR").format(value).replace(/[  ]/g, " ")} FCFA`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function nextActions(order) {
  if (order.status === "NEW") return [["CONFIRMED", "Confirmer"], ["CANCELLED", "Annuler"]];
  if (order.status === "CONFIRMED") return [["DELIVERED", "Marquer livrée"], ["CANCELLED", "Annuler"]];
  return [];
}

function applyFilter(order) {
  if (!filter) return true;
  if (filter === "UNPAID") return order.paymentStatus === "UNPAID" && order.status !== "CANCELLED";
  return order.status === filter;
}

function paymentMarkup(order) {
  if (order.status === "CANCELLED") return "";
  if (order.paymentStatus === "PAID") {
    const detail = [order.paymentMethod, order.paymentNote].filter(Boolean).join(" · ");
    return `<div class="payment-line paid"><span>✅ Payée${detail ? ` — ${escapeHtml(detail)}` : ""}</span><button type="button" class="text-button" data-unpay="${escapeHtml(order.id)}">Pas encore payée</button></div>`;
  }
  if (payingId === order.id) {
    return `
      <form class="payment-form" data-pay-form="${escapeHtml(order.id)}">
        <select aria-label="Moyen de paiement">${PAYMENT_METHODS.map((method) => `<option>${escapeHtml(method)}</option>`).join("")}</select>
        <input type="text" maxlength="200" placeholder="Référence ou note (facultatif)" aria-label="Référence du paiement" />
        <button type="submit" class="primary">Valider</button>
        <button type="button" class="text-button" data-pay-cancel>Annuler</button>
      </form>`;
  }
  return `
    <div class="payment-line unpaid${order.proofReceived ? " proof" : ""}">
      <span>${order.proofReceived ? "💳 Le client a envoyé une preuve : vérifiez votre compte Mobile Money" : "⏳ Paiement en attente"}</span>
      <button type="button" class="text-button" data-pay="${escapeHtml(order.id)}">Marquer payée</button>
    </div>`;
}

function renderOrders() {
  const container = $("#orders-list");
  const visible = orders.filter(applyFilter);
  $("#orders-count").textContent = `${visible.length} commande${visible.length === 1 ? "" : "s"}`;

  if (!visible.length) {
    container.innerHTML = '<div class="empty-state">Aucune commande pour le moment.</div>';
    return;
  }

  container.innerHTML = visible.map((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const phone = order.customerPhone ? `+${String(order.customerPhone).replace(/^\+/, "")}` : "";
    return `
    <article class="order-card status-${order.status.toLowerCase()}">
      <header class="order-card-head">
        <div>
          <strong>${escapeHtml(order.customerName)}</strong>
          <small class="muted">${escapeHtml(phone)}${phone ? " • " : ""}${escapeHtml(formatDate(order.createdAt))}</small>
        </div>
        <span class="appointment-status">${STATUS_LABELS[order.status] || order.status}</span>
      </header>
      <ul class="order-items">
        ${items.map((item) => `<li><span>${escapeHtml(item.quantity)} × ${escapeHtml(item.name)}</span><small class="muted">${escapeHtml(item.unitPrice || "")}</small></li>`).join("")}
      </ul>
      <p class="order-address"><small class="muted">Livraison</small><br />${escapeHtml(order.deliveryAddress)}</p>
      ${order.notes ? `<p class="muted">${escapeHtml(order.notes)}</p>` : ""}
      ${paymentMarkup(order)}
      <footer class="order-card-foot">
        <strong>${order.total !== null && order.total !== undefined ? escapeHtml(formatMoney(order.total)) : "Total à confirmer"}</strong>
        <div class="appointment-actions">
          ${nextActions(order).map(([status, label]) => `<button type="button" class="text-button${status === "CANCELLED" ? " danger-text" : ""}" data-order="${escapeHtml(order.id)}" data-status="${status}">${label}</button>`).join("")}
        </div>
      </footer>
    </article>`;
  }).join("");

  $$("[data-order]", container).forEach((button) => {
    button.onclick = () => changeStatus(button.dataset.order, button.dataset.status);
  });
  $$("[data-pay]", container).forEach((button) => {
    button.onclick = () => {
      payingId = button.dataset.pay;
      renderOrders();
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
    button.onclick = () => {
      if (window.confirm("Remettre cette commande en « paiement en attente » ?")) void setPayment(button.dataset.unpay, { paymentStatus: "UNPAID" });
    };
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
  if (status === "CANCELLED" && !window.confirm("Annuler cette commande ?")) return;
  try {
    await api(`${base()}/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    await loadOrders();
  } catch (error) {
    showToast(error.message || "Mise à jour impossible.", "error");
  }
}

export async function loadOrders() {
  if (!getState().organizationId) return;
  try {
    const [settings, list] = await Promise.all([api(`${base()}/settings`), api(base())]);
    $("#orders-enabled").checked = Boolean(settings.settings.enabled);
    orders = list.orders;
    renderOrders();
  } catch (error) {
    showToast(error.message || "Impossible de charger les commandes.", "error");
  }
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
      filter = button.dataset.filter;
      $$(".orders-filter").forEach((other) => other.classList.toggle("active", other === button));
      renderOrders();
    };
  });
}
