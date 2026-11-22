import { api } from "../../services/api.js";
import { $, $$, escapeHtml } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { STAGES, STAGE_LABELS, STAGE_TONES } from "../../utils/labels.js";
import { formatCompact, formatMoney, formatNumber, plural } from "../../utils/format.js";
import { isAgentRole } from "../navigation/roles.js";
import { renderColumnChart, sparklineMarkup } from "../../ui/charts.js";
import { icon } from "../../ui/icons.js";

/**
 * « Vos résultats » : ce qui s'est réellement passé sur la période (conversations, messages, commandes, ventes),
 * comparé à la période précédente de même durée. Les chiffres viennent du serveur ; seul le « temps gagné »
 * est une estimation, et il est présenté comme tel.
 */

/** Complément de « comparé … » et de « … sur … » pour chaque période. */
const COMPARED_TO = { 1: "à hier à la même heure", 7: "aux 7 jours précédents", 30: "aux 30 jours précédents" };
const PREVIOUS_PERIOD = { 1: "hier à la même heure", 7: "les 7 jours précédents", 30: "les 30 jours précédents" };

let days = 7;
let chartMetric = "clientMessages";
let latest = null;
let callbacks = { onLoaded: null, openConversation: null, openAgentSection: null };

/** Dernières statistiques chargées (pour « À traiter » sur l'accueil), ou null. */
export function getLatestStats() {
  return latest;
}

function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

/** Évolution par rapport à la période précédente. Renvoie "" quand la comparaison n'a pas de sens. */
function deltaMarkup(current, previous, comparison) {
  if (!previous && !current) return "";
  if (!previous) return `<span class="kpi-delta flat" title="Aucune activité sur ${escapeHtml(comparison)}">Nouveau</span>`;
  const percent = Math.round(((current - previous) / previous) * 100);
  const direction = percent > 0 ? "up" : percent < 0 ? "down" : "flat";
  const arrow = direction === "up" ? icon("trend-up", "icon-xs") : direction === "down" ? icon("trend-down", "icon-xs") : "";
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `<span class="kpi-delta ${direction}" title="${escapeHtml(`${formatNumber(previous)} sur ${comparison}`)}">${arrow}${sign}${Math.abs(percent)}&nbsp;%</span>`;
}

/** Tuile de chiffre : libellé, valeur (unité en petit), évolution, précision et courbe de tendance. */
function kpiCard({ label, value, unit = "", hint, delta, spark, iconName }) {
  return `<article class="card kpi-card">
    <span class="kpi-label">${icon(iconName, "icon-sm")}${escapeHtml(label)}</span>
    <div class="kpi-figure"><p class="kpi-value">${escapeHtml(value)}${unit ? `<span class="kpi-unit">${escapeHtml(unit)}</span>` : ""}</p>${delta}</div>
    <div class="kpi-bottom"><span class="kpi-hint">${escapeHtml(hint)}</span>${spark}</div>
  </article>`;
}

function kpiGrid(stats) {
  const comparison = PREVIOUS_PERIOD[stats.days] || "la période précédente";
  const series = stats.series || [];
  const spark = (key) => sparklineMarkup(series.map((point) => point[key] || 0));
  const share = stats.messages.assistantShare;
  return `<div class="kpi-grid">
    ${kpiCard({
      label: "Conversations", iconName: "chats",
      value: formatNumber(stats.conversations.started),
      hint: `Nouvelles · ${formatNumber(stats.conversations.total)} au total`,
      delta: deltaMarkup(stats.conversations.started, stats.previous?.conversations, comparison),
      spark: spark("conversations"),
    })}
    ${kpiCard({
      label: "Réponses de l'agent", iconName: "sparkles",
      value: formatNumber(stats.messages.byAssistant),
      hint: share === null ? "Aucune sur la période" : `${share} % des réponses`,
      delta: deltaMarkup(stats.messages.byAssistant, stats.previous?.assistantMessages, comparison),
      spark: spark("assistantMessages"),
    })}
    ${kpiCard({
      label: "Commandes", iconName: "bag",
      value: formatNumber(stats.orders.count),
      hint: stats.orders.count ? (stats.orders.unpaid ? `${formatNumber(stats.orders.unpaid)} à encaisser` : "Toutes encaissées") : "Aucune sur la période",
      delta: deltaMarkup(stats.orders.count, stats.previous?.orders, comparison),
      spark: spark("orders"),
    })}
    ${kpiCard({
      label: "Ventes", iconName: "banknote",
      value: formatNumber(stats.orders.revenue), unit: "FCFA",
      hint: stats.orders.revenue ? `${formatMoney(stats.orders.paidRevenue)} encaissés` : "Montant des commandes",
      delta: deltaMarkup(stats.orders.revenue, stats.previous?.revenue, comparison),
      spark: spark("revenue"),
    })}
  </div>`;
}

const CHART_METRICS = {
  clientMessages: { label: "Messages", name: "Messages reçus de vos clients, jour par jour", format: (value) => plural(value, "message reçu", "messages reçus"), axis: formatCompact },
  conversations: { label: "Conversations", name: "Nouvelles conversations, jour par jour", format: (value) => plural(value, "nouvelle conversation", "nouvelles conversations"), axis: formatCompact },
  orders: { label: "Commandes", name: "Commandes, jour par jour", format: (value) => plural(value, "commande", "commandes"), axis: formatCompact },
  revenue: { label: "Ventes", name: "Ventes en francs CFA, jour par jour", format: formatMoney, axis: formatCompact },
};

function drawChart() {
  const container = $("#activity-chart");
  if (!container || !latest) return;
  const metric = CHART_METRICS[chartMetric];
  const points = latest.series.map((point) => {
    const date = new Date(`${point.day}T12:00:00`);
    const full = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return {
      label: full.charAt(0).toUpperCase() + full.slice(1),
      shortLabel: date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }),
      tinyLabel: date.toLocaleDateString("fr-FR", { day: "numeric" }),
      value: point[chartMetric] || 0,
    };
  });
  renderColumnChart(container, { points, name: metric.name, formatValue: metric.format, formatAxis: metric.axis });
  const total = points.reduce((sum, point) => sum + point.value, 0);
  $("#activity-total").textContent = total ? `${chartMetric === "revenue" ? formatMoney(total) : formatNumber(total)} sur la période` : "Aucune activité sur la période";
  $$("#chart-metric button").forEach((button) => {
    const active = button.dataset.metric === chartMetric;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function chartCard(stats) {
  if ((stats.series || []).length < 2) return "";
  return `<section class="card chart-card" aria-labelledby="chart-title">
    <header class="card-header">
      <div><h3 class="card-title" id="chart-title">Activité jour par jour</h3><p class="card-subtitle" id="activity-total"></p></div>
      <div class="segmented chart-metric" id="chart-metric" role="group" aria-label="Donnée affichée">
        ${Object.entries(CHART_METRICS).map(([key, metric]) => `<button type="button" data-metric="${key}">${escapeHtml(metric.label)}</button>`).join("")}
      </div>
    </header>
    <div class="card-body"><div id="activity-chart" class="activity-chart"></div></div>
  </section>`;
}

function fact(iconName, label, value, title = "") {
  return `<div class="fact"${title ? ` title="${escapeHtml(title)}"` : ""}><span class="fact-icon">${icon(iconName, "icon-sm")}</span><span class="fact-text"><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></span></div>`;
}

function agentCard(stats) {
  const share = stats.messages.assistantShare;
  const facts = [
    fact("clock", "Temps gagné (estimé)", `≈ ${duration(stats.estimatedMinutesSaved)}`, "Estimation : environ une minute par réponse de l'agent"),
    fact("message-text", "Messages reçus", formatNumber(stats.messages.fromClients)),
    fact("reply", "Réponses de l'équipe", formatNumber(stats.messages.byTeam), "Écrites par vous ou vos employés"),
    fact("hand", "Passages de main", formatNumber(stats.handoffs), "Fois où l'agent a demandé une personne"),
    fact("calendar-check", "Rendez-vous pris", formatNumber(stats.appointments)),
  ];
  if (stats.afterHours.enabled) facts.push(fact("moon", "Messages hors horaires", formatNumber(stats.afterHours.clientMessages), "Reçus quand votre entreprise était fermée"));
  return `<section class="card agent-work-card" aria-labelledby="agent-work-title">
    <header class="card-header"><div><h3 class="card-title" id="agent-work-title">Le travail de votre agent</h3><p class="card-subtitle">Ce qu'il a pris en charge à votre place.</p></div></header>
    <div class="card-body">
      <div class="share-figure">
        <p class="share-value">${share === null ? "—" : `${share}&nbsp;%`}</p>
        <p class="share-label">des réponses envoyées par l'agent, sans intervention de votre part</p>
        <div class="progress progress-lg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share ?? 0}" aria-label="Part des réponses envoyées par l'agent"><span style="width:${share ?? 0}%"></span></div>
      </div>
      <div class="fact-grid">${facts.join("")}</div>
    </div>
  </section>`;
}

/** Part des conversations de la période qui ont donné une commande ou un rendez-vous, puis répartition des clients par étape. */
function conversionMarkup(conversion, stages) {
  const { rate, converted, activeConversations } = conversion;
  const detail = activeConversations
    ? `${formatNumber(converted)} sur ${plural(activeConversations, "conversation a", "conversations ont")} donné une commande ou un rendez-vous.`
    : "Aucune conversation sur la période.";
  const total = STAGES.reduce((sum, stage) => sum + (stages[stage] || 0), 0);
  const stageRows = total
    ? `<div class="stage-lines"><p class="insight-sub">Où en sont tous vos clients</p>${STAGES.map((stage) => {
      const count = stages[stage] || 0;
      return `<div class="stage-line"><span class="badge ${STAGE_TONES[stage]}">${escapeHtml(STAGE_LABELS[stage])}</span><div class="progress" aria-hidden="true"><span style="width:${Math.round((count / total) * 100)}%"></span></div><b class="num">${formatNumber(count)}</b></div>`;
    }).join("")}</div>`
    : "";
  return `<section class="card insight-card" aria-labelledby="insight-conversion">
    <h3 id="insight-conversion" class="card-title">Conversations qui aboutissent</h3>
    <p class="insight-figure"><strong>${rate === null ? "—" : `${rate}&nbsp;%`}</strong></p>
    <div class="progress progress-lg success" aria-hidden="true"><span style="width:${rate ?? 0}%"></span></div>
    <p class="insight-note">${escapeHtml(detail)}</p>
    ${stageRows}
  </section>`;
}

function topProductsMarkup(products) {
  const max = Math.max(1, ...products.map((product) => product.interested));
  const rows = products.map((product, index) => {
    const facts = [plural(product.interested, "client intéressé", "clients intéressés")];
    if (product.photos) facts.push(plural(product.photos, "photo envoyée", "photos envoyées"));
    if (product.ordered) facts.push(plural(product.ordered, "commandé", "commandés"));
    return `<li><span class="insight-rank">${index + 1}</span><div class="insight-product"><b class="truncate">${escapeHtml(product.name)}</b><div class="progress" aria-hidden="true"><span style="width:${Math.round((product.interested / max) * 100)}%"></span></div><small>${escapeHtml(facts.join(" · "))}</small></div></li>`;
  }).join("");
  return `<section class="card insight-card" aria-labelledby="insight-products">
    <h3 id="insight-products" class="card-title">Articles les plus demandés</h3>
    ${rows ? `<ol class="insight-list">${rows}</ol>` : `<div class="empty empty-compact"><span class="empty-icon">${icon("package")}</span><p class="empty-text">Aucun article demandé sur la période. Ils apparaîtront ici dès que vos clients parleront de vos produits.</p></div>`}
  </section>`;
}

/** Informations que les clients ont demandées et que l'agent n'avait pas : à ajouter dans « Agent IA ». */
function unansweredMarkup(unanswered) {
  const rows = unanswered.items.map((item) => {
    const date = new Date(item.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return `<li><button type="button" class="insight-question" data-conversation="${escapeHtml(item.conversationId)}" title="Ouvrir la conversation">
      <b>${escapeHtml(item.missing)}</b>
      ${item.question ? `<q>${escapeHtml(item.question)}</q>` : ""}
      <small>${escapeHtml(item.contact)} · ${escapeHtml(date)}</small>
    </button></li>`;
  }).join("");
  const more = unanswered.count > unanswered.items.length ? `<p class="insight-note">Et ${formatNumber(unanswered.count - unanswered.items.length)} de plus sur la période.</p>` : "";
  const cta = isAgentRole() ? "" : `<button type="button" class="btn btn-soft btn-sm insight-cta" data-complete-knowledge>${icon("book")}Compléter les informations de l'agent</button>`;
  return `<section class="card insight-card" aria-labelledby="insight-unanswered">
    <h3 id="insight-unanswered" class="card-title">Questions restées sans réponse${unanswered.count ? ` <span class="count">${formatNumber(unanswered.count)}</span>` : ""}</h3>
    ${rows
      ? `<p class="insight-note">Votre agent n'avait pas ces informations. Ajoutez-les pour qu'il sache répondre la prochaine fois.</p><ul class="insight-list insight-questions">${rows}</ul>${more}${cta}`
      : `<div class="empty empty-compact"><span class="empty-icon success-icon">${icon("check-circle")}</span><p class="empty-text">Aucune sur la période. Quand un client demandera une information que votre agent n'a pas, elle apparaîtra ici.</p></div>`}
  </section>`;
}

function render(stats) {
  const body = $("#stats-body");
  const chart = chartCard(stats);
  body.innerHTML = `${kpiGrid(stats)}
    <div class="results-grid${chart ? "" : " no-chart"}">${chart}${agentCard(stats)}</div>
    <div class="stats-insights">${conversionMarkup(stats.conversion, stats.stages)}${topProductsMarkup(stats.topProducts || [])}${unansweredMarkup(stats.unanswered || { count: 0, items: [] })}</div>`;
  body.classList.remove("is-refreshing");
  $$(".insight-question", body).forEach((button) => {
    button.onclick = () => callbacks.openConversation?.(button.dataset.conversation);
  });
  $("[data-complete-knowledge]", body)?.addEventListener("click", () => callbacks.openAgentSection?.("knowledge", "#business-info"));
  $$("#chart-metric button", body).forEach((button) => {
    button.onclick = () => {
      chartMetric = button.dataset.metric;
      drawChart();
    };
  });
  if (chart) drawChart();

  const from = new Date(`${stats.from}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  $("#stats-subtitle").textContent = stats.days === 1
    ? `Depuis ce matin, comparé ${COMPARED_TO[1]}.`
    : `Depuis le ${from}, comparé ${COMPARED_TO[stats.days] || "à la période précédente"}.`;
}

/**
 * @param {{ onLoaded?: () => void, openConversation?: (id: string) => void, openAgentSection?: (tab: string, focus: string) => void }} [nextCallbacks]
 */
export async function loadStats(nextCallbacks) {
  if (nextCallbacks) callbacks = { ...callbacks, ...nextCallbacks };
  const body = $("#stats-body");
  if (!body || !getState().organizationId) return;
  // Pendant le rechargement, on garde l'affichage précédent (légèrement estompé) : pas de saut de mise en page.
  if (latest) body.classList.add("is-refreshing");
  try {
    const { stats } = await api(`/organizations/${getState().organizationId}/stats?days=${days}`);
    latest = stats;
    render(stats);
  } catch (error) {
    latest = null;
    body.classList.remove("is-refreshing");
    body.innerHTML = `<div class="card"><div class="empty"><span class="empty-icon">${icon("alert")}</span><p class="empty-title">Chiffres indisponibles</p><p class="empty-text">${escapeHtml(error.message || "Impossible de charger les chiffres.")}</p><button type="button" class="btn btn-secondary" id="stats-retry">${icon("refresh")}Réessayer</button></div></div>`;
    $("#stats-retry")?.addEventListener("click", () => void loadStats());
  }
  callbacks.onLoaded?.();
}

export function initStats() {
  $$("#stats-period button").forEach((button) => {
    button.onclick = () => {
      days = Number(button.dataset.period) || 7;
      $$("#stats-period button").forEach((other) => {
        const active = other === button;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      void loadStats();
    };
  });
}
