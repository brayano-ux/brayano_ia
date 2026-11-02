import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { formatDateTime } from "../../utils/format.js";
import { readSession } from "../../services/storage.js";
import { isAgentRole } from "../navigation/roles.js";

/**
 * « Mon forfait » : où en est l'entreprise (essai ou forfait, messages utilisés), choix d'un forfait et paiement Mobile Money,
 * et bandeau d'alerte quand les messages de l'assistant s'épuisent. Les forfaits ne coupent rien tant que le serveur ne les applique pas.
 */

const POLL_MS = 4000;
const POLL_MAX_MS = 3 * 60_000;
const CACHE_MS = 20_000;

let plansData = null;
let statusCache = { at: 0, value: null };
let paying = null;
let pollTimer = null;

const money = (value) => `${new Intl.NumberFormat("fr-FR").format(value).replace(/[  ]/g, " ")} FCFA`;
const count = (value) => new Intl.NumberFormat("fr-FR").format(value).replace(/[  ]/g, " ");

/** Statut du forfait (gardé 20 s pour ne pas redemander à chaque page). Renvoie null pour un employé ou en cas d'erreur. */
export async function getBillingStatus({ fresh = false } = {}) {
  if (isAgentRole() || !readSession()?.token) return null;
  if (!fresh && statusCache.value && Date.now() - statusCache.at < CACHE_MS) return statusCache.value;
  try {
    statusCache = { at: Date.now(), value: await api("/billing/account") };
  } catch {
    statusCache = { at: 0, value: null };
  }
  return statusCache.value;
}

/* ------------------------------------------------------------- bandeau */

export async function refreshBillingBanner() {
  const banner = $("#billing-banner");
  if (!banner) return;
  const status = await getBillingStatus({ fresh: true });
  const low = status && status.enforced && status.messageLimit > 0 && status.remainingMessages / status.messageLimit <= 0.2;
  if (!status || !status.enforced || (!status.blocked && !low)) {
    banner.classList.add("hidden");
    banner.textContent = "";
    return;
  }
  const noun = status.isTrial ? "messages d'essai" : "messages de l'assistant";
  const text = status.blocked
    ? (status.isTrial
      ? "Votre essai gratuit est terminé : l'assistant ne répond plus à vos clients. Choisissez un forfait pour le réactiver."
      : status.status === "EXPIRED" && status.remainingMessages > 0
        ? "Votre abonnement est terminé : l'assistant ne répond plus à vos clients. Renouvelez votre forfait pour le réactiver."
        : "Vous avez utilisé tous les messages de votre forfait : l'assistant ne répond plus à vos clients. Passez à un forfait supérieur.")
    : `Il vous reste ${count(status.remainingMessages)} ${noun} sur ${count(status.messageLimit)}.`;
  banner.className = `billing-banner${status.blocked ? " is-blocked" : ""}`;
  banner.innerHTML = `<span>${escapeHtml(text)}</span><button type="button" class="ghost-button">Voir les forfaits</button>`;
  banner.querySelector("button").onclick = () => $('.nav-item[data-view="billing"]')?.click();
}

/* --------------------------------------------------------------- page */

function statusMarkup(status) {
  const used = status.messagesUsed;
  const percent = status.messageLimit ? Math.min(100, Math.round((used / status.messageLimit) * 100)) : 0;
  const tone = status.blocked ? "danger" : percent >= 80 ? "warning" : "ok";
  const renewal = status.expiresAt ? `${status.status === "ACTIVE" ? "Valable jusqu'au" : "Terminé depuis le"} ${new Date(status.expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : "";
  const alert = status.blocked
    ? `<p class="billing-alert danger">L'assistant ne répond plus à vos clients. Choisissez un forfait ci-dessous pour le réactiver. Vous pouvez toujours répondre vous-même dans « Conversations ».</p>`
    : !status.enforced
      ? `<p class="billing-alert info">Les forfaits ne sont pas encore appliqués : l'assistant répond normalement à vos clients. Vos messages sont déjà comptés pour que vous voyiez votre consommation.</p>`
      : "";
  return `
    <div class="billing-status-head">
      <div>
        <p class="eyebrow">VOTRE FORFAIT ACTUEL</p>
        <h2>${escapeHtml(status.planName)}${status.isTrial ? "" : status.status === "ACTIVE" ? ' <span class="status-chip success">Actif</span>' : ' <span class="status-chip warning">Terminé</span>'}</h2>
        ${renewal ? `<p class="muted">${escapeHtml(renewal)}</p>` : ""}
      </div>
      <div class="billing-count"><strong>${count(status.remainingMessages)}</strong><span>message${status.remainingMessages > 1 ? "s" : ""} restant${status.remainingMessages > 1 ? "s" : ""}</span></div>
    </div>
    <div class="billing-meter ${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
    <p class="muted billing-meter-label">${count(used)} utilisé${used > 1 ? "s" : ""} sur ${count(status.messageLimit)} ${status.isTrial ? "(essai gratuit)" : "ce mois-ci"}</p>
    ${alert}`;
}

function planCardMarkup(plan, status) {
  const current = status && !status.isTrial && status.plan === plan.key && status.status === "ACTIVE";
  const label = current ? "Renouveler" : status && !status.isTrial && status.status === "ACTIVE" ? "Choisir ce forfait" : "Choisir ce forfait";
  return `
    <article class="plan-card${current ? " is-current" : ""}">
      ${current ? '<span class="plan-badge">Votre forfait</span>' : ""}
      <h3>${escapeHtml(plan.name)}</h3>
      <p class="plan-tagline">${escapeHtml(plan.tagline)}</p>
      <p class="plan-price"><strong>${escapeHtml(money(plan.amount))}</strong><span> / mois</span></p>
      <ul>${plan.highlights.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
      <button type="button" class="${current ? "ghost-button" : "primary"}" data-choose="${escapeHtml(plan.key)}">${label}</button>
    </article>`;
}

export async function loadBilling() {
  const [status, plans] = await Promise.all([
    getBillingStatus({ fresh: true }),
    plansData ? Promise.resolve(plansData) : api("/billing/plans").catch(() => null),
  ]);
  if (plans) plansData = plans;
  const statusBox = $("#billing-status");
  statusBox.innerHTML = status ? statusMarkup(status) : '<div class="empty-state">Impossible de charger votre forfait pour le moment.</div>';
  const grid = $("#billing-plans");
  grid.innerHTML = plansData ? plansData.plans.map((plan) => planCardMarkup(plan, status)).join("") : "";
  $$("[data-choose]", grid).forEach((button) => {
    button.onclick = () => openPayment(button.dataset.choose);
  });
  if (plansData?.supportEmail) $("#billing-support").innerHTML = `Une question ? Écrivez-nous à <a href="mailto:${escapeHtml(plansData.supportEmail)}">${escapeHtml(plansData.supportEmail)}</a>.`;
}

/* ----------------------------------------------------------- paiement */

function closePayment() {
  clearTimeout(pollTimer);
  paying = null;
  $("#billing-pay").classList.add("hidden");
}

function openPayment(planKey) {
  const plan = plansData?.plans.find((entry) => entry.key === planKey);
  if (!plan) return;
  paying = { plan };
  $("#billing-pay-title").textContent = `Payer le forfait ${plan.name}`;
  $("#billing-pay-amount").textContent = `${money(plan.amount)} pour 30 jours`;
  $("#billing-pay-form").classList.remove("hidden");
  $("#billing-pay-wait").classList.add("hidden");
  $("#billing-pay-submit").disabled = false;
  $("#billing-pay").classList.remove("hidden");
  $("#billing-pay-phone").focus();
}

async function submitPayment(event) {
  event.preventDefault();
  if (!paying) return;
  const phone = $("#billing-pay-phone").value.trim();
  const button = $("#billing-pay-submit");
  button.disabled = true;
  try {
    const result = await api("/billing/checkout/chariow", { method: "POST", body: JSON.stringify({ plan: paying.plan.key, phone }) });
    $("#billing-pay-form").classList.add("hidden");
    $("#billing-pay-wait").classList.remove("hidden");
    $("#billing-pay-wait-text").textContent = "Redirection vers la page de paiement sécurisée...";
    window.location.href = result.checkoutUrl;
  } catch (error) {
    button.disabled = false;
    showToast(error.message || "Le paiement n'est pas disponible pour le moment.", "error");
  }
}

/**
 * Après un paiement Chariow, le client revient sur le tableau de bord (CLIENT_DASHBOARD_URL?chariow=done).
 * L'abonnement est déjà activé côté serveur par le webhook Chariow, indépendamment de ce retour : on
 * se contente ici de réinterroger « Mon forfait » jusqu'à voir le changement, pour ne pas laisser
 * l'utilisateur sur un écran visiblement pas encore à jour juste après avoir payé.
 */
export async function handleChariowReturn() {
  showToast("Paiement reçu, confirmation de votre forfait en cours…", "info");
  const startedAt = Date.now();
  const planBefore = (await getBillingStatus())?.plan ?? null;
  const tick = async () => {
    statusCache = { at: 0, value: null };
    const status = await getBillingStatus({ fresh: true }).catch(() => null);
    await loadBilling().catch(() => undefined);
    void refreshBillingBanner();
    if (status && status.status === "ACTIVE" && status.plan !== planBefore) {
      showToast("Paiement confirmé : votre forfait est activé. Merci !", "success");
      return;
    }
    if (Date.now() - startedAt > POLL_MAX_MS) return;
    pollTimer = setTimeout(() => void tick(), POLL_MS);
  };
  await tick();
}

export function initBilling() {
  $("#billing-pay-form").onsubmit = submitPayment;
  $("#billing-pay-close").onclick = closePayment;
  $("#billing-pay-cancel").onclick = closePayment;
  $("#billing-pay").addEventListener("click", (event) => {
    if (event.target.id === "billing-pay") closePayment();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#billing-pay").classList.contains("hidden")) closePayment();
  });
}
