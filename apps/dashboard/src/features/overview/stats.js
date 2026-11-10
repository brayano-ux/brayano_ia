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

const plural = (count, one, many) => `${number(count)} ${count > 1 ? many : one}`;

/** Part des conversations de la période qui ont donné une commande ou un rendez-vous. */
function conversionMarkup(conversion) {
  const { rate, converted, activeConversations } = conversion;
  const detail = activeConversations
    ? `${number(converted)} sur ${plural(activeConversations, "conversation a", "conversations ont")} donné une commande ou un rendez-vous.`
    : "Aucune conversation sur la période.";
  return `<section class="insight-card" aria-labelledby="insight-conversion">
    <h3 id="insight-conversion">Conversations qui aboutissent</h3>
    <p class="insight-figure"><strong>${rate === null ? "—" : `${rate} %`}</strong></p>
    <div class="stage-track" aria-hidden="true"><i class="stage-fill stage-ordered" style="width:${rate ?? 0}%"></i></div>
    <p class="insight-note">${escapeHtml(detail)}</p>
  </section>`;
}

function topProductsMarkup(products) {
  const rows = products.map((product, index) => {
    const facts = [plural(product.interested, "client intéressé", "clients intéressés")];
    if (product.photos) facts.push(plural(product.photos, "photo envoyée", "photos envoyées"));
    if (product.ordered) facts.push(plural(product.ordered, "commandé", "commandés"));
    return `<li><span class="insight-rank">${index + 1}</span><div><b>${escapeHtml(product.name)}</b><small>${escapeHtml(facts.join(" · "))}</small></div></li>`;
  }).join("");
  return `<section class="insight-card" aria-labelledby="insight-products">
    <h3 id="insight-products">Articles les plus demandés</h3>
    ${rows ? `<ol class="insight-list">${rows}</ol>` : '<p class="insight-note">Aucun article demandé sur la période. Ils apparaîtront ici dès que vos clients parleront de vos produits.</p>'}
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
  const more = unanswered.count > unanswered.items.length ? `<p class="insight-note">Et ${number(unanswered.count - unanswered.items.length)} de plus sur la période.</p>` : "";
  return `<section class="insight-card" aria-labelledby="insight-unanswered">
    <h3 id="insight-unanswered">Questions restées sans réponse${unanswered.count ? ` <span class="status-chip warning">${number(unanswered.count)}</span>` : ""}</h3>
    ${rows
      ? `<p class="insight-note">Votre agent n'avait pas ces informations. Ajoutez-les dans « Agent IA » pour qu'il sache répondre.</p><ul class="insight-list">${rows}</ul>${more}`
      : '<p class="insight-note">Aucune sur la période. Quand un client demandera une information que votre agent n\'a pas, elle apparaîtra ici.</p>'}
  </section>`;
}

let openConversationFromStats = null;

export async function loadStats(onSelectConversation) {
  if (onSelectConversation) openConversationFromStats = onSelectConversation;
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
    const insights = stats.conversion
      ? `<div class="stats-insights">${conversionMarkup(stats.conversion)}${topProductsMarkup(stats.topProducts || [])}${unansweredMarkup(stats.unanswered || { count: 0, items: [] })}</div>`
      : "";
    body.innerHTML = `<div class="stats-grid">${cards.join("")}</div>${insights}<div class="stats-lower">${chartMarkup(stats.series)}${stagesMarkup(stats.stages)}</div>`;
    body.querySelectorAll(".insight-question").forEach((button) => {
      button.onclick = () => openConversationFromStats?.(button.dataset.conversation);
    });
    $("#stats-subtitle").textContent = `Depuis le ${new Date(`${stats.from}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} (heure de ${stats.timezone}).`;
  } catch (error) {
    body.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "Impossible de charger les chiffres.")}</div>`;
  }
}

export function initStats() {
  $("#stats-period")?.addEventListener("change", () => void loadStats());
}
