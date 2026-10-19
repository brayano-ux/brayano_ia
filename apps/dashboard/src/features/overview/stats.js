import { api } from "../../services/api.js";
import { $, escapeHtml } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { STAGES, STAGE_LABELS } from "../../utils/labels.js";

/**
 * Tableau de bord utile : ce que l'agent a réellement fait sur la période (conversations, messages, commandes,
 * rendez-vous, passages de main). Les chiffres viennent du serveur ; seul le « temps gagné » est une estimation.
 */

const number = (value) => new Intl.NumberFormat("fr-FR").format(value);
const money = (value) => `${number(value)} FCFA`;

function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function card(label, value, hint, tone = "") {
  return `<article class="stat-card ${tone}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(hint)}</span></article>`;
}

function chartMarkup(series) {
  const max = Math.max(1, ...series.map((point) => Math.max(point.clientMessages, point.assistantMessages)));
  if (series.length < 2) return "";
  return `
    <div class="stats-chart" role="img" aria-label="Messages reçus et réponses de l'agent, jour par jour">
      ${series.map((point) => {
        const label = new Date(`${point.day}T12:00:00`).toLocaleDateString("fr-FR", series.length > 8 ? { day: "numeric" } : { weekday: "short", day: "numeric" });
        return `<div class="stats-chart-col" title="${escapeHtml(point.day)} : ${point.clientMessages} message(s) reçus, ${point.assistantMessages} réponse(s) de l'agent, ${point.orders} commande(s)">
          <div class="bars"><i class="bar-in" style="height:${Math.round((point.clientMessages / max) * 100)}%"></i><i class="bar-ai" style="height:${Math.round((point.assistantMessages / max) * 100)}%"></i></div>
          <span>${escapeHtml(label)}</span>
        </div>`;
      }).join("")}
    </div>
    <p class="stats-legend"><span><i class="bar-in"></i>Messages des clients</span><span><i class="bar-ai"></i>Réponses de l'agent</span></p>`;
}

function stagesMarkup(stages) {
  const total = STAGES.reduce((sum, stage) => sum + (stages[stage] || 0), 0);
  if (!total) return "";
  return `<div class="stats-stages"><h3>Où en sont vos clients</h3>${STAGES.map((stage) => {
    const count = stages[stage] || 0;
    return `<div class="stage-line"><span>${escapeHtml(STAGE_LABELS[stage])}</span><div class="stage-track"><i class="stage-fill stage-${stage.toLowerCase()}" style="width:${Math.round((count / total) * 100)}%"></i></div><b>${count}</b></div>`;
  }).join("")}</div>`;
}

export async function loadStats() {
  const body = $("#stats-body");
  if (!body || !getState().organizationId) return;
  const days = Number($("#stats-period").value) || 7;
  try {
    const { stats } = await api(`/organizations/${getState().organizationId}/stats?days=${days}`);
    const share = stats.messages.assistantShare;
    const cards = [
      card("Conversations démarrées", number(stats.conversations.started), `${number(stats.conversations.total)} au total`),
      card("Messages reçus", number(stats.messages.fromClients), "de vos clients"),
      card("Réponses de l'agent", number(stats.messages.byAssistant), share === null ? "—" : `${share} % des réponses`, "accent"),
      card("Réponses de l'équipe", number(stats.messages.byTeam), "envoyées par vous ou vos employés"),
      card("Commandes", number(stats.orders.count), stats.orders.count ? `${money(stats.orders.revenue)} · ${stats.orders.unpaid} à encaisser` : "aucune sur la période", "success"),
      card("Rendez-vous", number(stats.appointments), "pris par l'agent ou l'équipe", "success"),
      card("Passages de main", number(stats.handoffs), stats.handoffs ? "l'agent a demandé une personne" : "l'agent s'est débrouillé seul"),
      card("Temps gagné (estimation)", duration(stats.estimatedMinutesSaved), "environ 1 min par réponse de l'agent"),
    ];
    if (stats.afterHours.enabled) {
      cards.push(card("Écrits hors horaires", number(stats.afterHours.clientMessages), "messages reçus entreprise fermée"));
    }
    body.innerHTML = `<div class="stats-grid">${cards.join("")}</div><div class="stats-lower">${chartMarkup(stats.series)}${stagesMarkup(stats.stages)}</div>`;
    $("#stats-subtitle").textContent = `Depuis le ${new Date(`${stats.from}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} (heure de ${stats.timezone}).`;
  } catch (error) {
    body.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "Impossible de charger les chiffres.")}</div>`;
  }
}

export function initStats() {
  $("#stats-period")?.addEventListener("change", () => void loadStats());
}
