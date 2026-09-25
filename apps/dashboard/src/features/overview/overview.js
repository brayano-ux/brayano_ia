import { api } from "../../services/api.js";
import { $, escapeHtml, showToast } from "../../utils/dom.js";
import { initials } from "../../utils/format.js";
import { buildProspectsCsv, downloadCsv } from "../../utils/csv.js";
import { getState, setState } from "../../state/store.js";
import { conversationMarkup, bindConversationRows } from "../inbox/conversation-item.js";
import { updateRealtimeHeader } from "../navigation/navigation.js";

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

  if (!sortedMetrics.length) {
    list.innerHTML = '<div class="empty-state">Aucun commercial configuré pour le moment.</div>';
    return;
  }

  list.innerHTML = sortedMetrics
    .map((entry) => {
      const badgeTone = entry.visibleCount > 0 ? "positive" : "neutral";
      const latestEntry = entry.messagesByDay[0];
      const latestDay = latestEntry
        ? new Date(`${latestEntry.day}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
        : "Aucun";
      return `
        <div class="commercial-item">
          <div class="commercial-head">
            <div class="commercial-avatar">${escapeHtml(initials(entry.name))}</div>
            <div>
              <strong>${escapeHtml(entry.name)}</strong>
              <small>${escapeHtml(entry.locationName)}</small>
            </div>
          </div>
          <div class="commercial-stats">
            <span class="metric-count ${badgeTone}">${entry.visibleCount}</span>
            <span class="commercial-label">messages</span>
          </div>
          <div class="commercial-meta">Dernier message : ${escapeHtml(latestDay)}</div>
        </div>
      `;
    })
    .join("");
}

async function loadCommercialMetrics() {
  try {
    const { commercialMetrics = [] } = await api(`/organizations/${getState().organizationId}/routing/commercial-metrics`);
    setState({ commercialMetrics });
    renderCommercialMetrics();
  } catch (error) {
    console.error(error);
  }
}

export async function exportProspects() {
  const button = $("#export-prospects");
  if (!button) return;

  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Préparation...";
  try {
    const { conversations: prospects = [] } = await api(`/organizations/${getState().organizationId}/prospects/export`);
    const csv = buildProspectsCsv(prospects);
    downloadCsv(csv, `prospects-${new Date().toISOString().slice(0, 10)}.csv`);
    showToast(`${prospects.length} prospect${prospects.length > 1 ? "s" : ""} exporté${prospects.length > 1 ? "s" : ""}.`, "success");
  } catch (error) {
    showToast(error.message || "Impossible d'exporter les prospects.", "error");
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function updateWhatsAppMetric(status) {
  const connected = status === "CONNECTED";
  const metric = $("#metric-whatsapp");
  metric.textContent = connected ? "Connecté" : "Déconnecté";
  metric.style.color = connected ? "var(--green)" : "var(--orange)";
  $("#metric-phone").textContent = connected ? "Numéro opérationnel" : "Connexion requise";
}

export function renderRecent(onSelectConversation) {
  const target = $("#recent-conversations");
  const { conversations } = getState();
  target.innerHTML = conversations.length
    ? conversations.slice(0, 4).map(conversationMarkup).join("")
    : '<div class="empty-state">Aucune conversation pour le moment.</div>';
  bindConversationRows(target, onSelectConversation);
}

export async function refreshOverview(onSelectConversation) {
  const orgId = getState().organizationId;
  const orgLabel = $("#org-select").selectedOptions[0]?.textContent || "Brayano";
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

    const activeConversationCount = conversations.filter((item) => item.status !== "CLOSED").length;
    $("#metric-active").textContent = activeConversationCount;
    $("#metric-messages").textContent = conversations.reduce((count, item) => count + (item.messages?.length || 0), 0);
    updateWhatsAppMetric(status.status);
    renderCommercialMetrics();
    renderRecent(onSelectConversation);
    $("#nav-count").textContent = activeConversationCount;
  } catch (error) {
    showToast(error.message, "error");
  }
}

export function initOverview() {
  $("#commercial-period")?.addEventListener("change", renderCommercialMetrics);
  $("#export-prospects")?.addEventListener("click", exportProspects);
}
