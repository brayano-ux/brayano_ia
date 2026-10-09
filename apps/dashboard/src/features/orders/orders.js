import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";

const STATUS_LABELS = { NEW: "Nouvelle", CONFIRMED: "Confirmée", DELIVERED: "Livrée", CANCELLED: "Annulée" };

let orders = [];
let filter = "";

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

function renderOrders() {
  const container = $("#orders-list");
  const visible = filter ? orders.filter((order) => order.status === filter) : orders;
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
