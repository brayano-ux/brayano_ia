import { api } from "../../services/api.js";
import { $, $$, debounce, escapeHtml, showToast } from "../../utils/dom.js";
import { formatPhone, formatRelativeTime } from "../../utils/format.js";
import { icon } from "../../ui/icons.js";
import { closeDrawer, openDrawer } from "../../ui/drawer.js";
import { confirmDialog } from "../../ui/confirm.js";

/**
 * « Clients » : réservé aux administrateurs de la plateforme (le serveur le vérifie sur chaque route /admin).
 * Liste de toutes les entreprises, création des clients sur mesure (payés en direct) et réglage de leur formule :
 * limite de messages par mois, messages groupés, relances, nombre d'employés.
 */

/** Doit rester égal à MAX_EMPLOYEES côté serveur (team.service.ts) ; le serveur refuse de toute façon au-delà. */
const MAX_EMPLOYEES = 10;
const DEFAULT_PLAN = { messageLimit: 1000, broadcasts: false, followUps: false, teamMembers: 0 };

let organizations = [];
let filter = "all";
let editing = null;
let saving = false;

const count = (value) => new Intl.NumberFormat("fr-FR").format(value).replace(/[  ]/g, " ");

function kindOf(organization) {
  const billing = organization.billing;
  if (billing?.isCustom) return "custom";
  if (!billing || billing.plan === "trial") return "trial";
  return "paid";
}

function planBadge(organization) {
  const billing = organization.billing;
  if (!billing) return '<span class="badge neutral">Formule inconnue</span>';
  if (billing.isCustom) return '<span class="badge violet">Sur mesure</span>';
  if (billing.plan === "trial") return '<span class="badge info">Essai gratuit</span>';
  return billing.status === "ACTIVE" ? `<span class="badge success">${escapeHtml(billing.planName)}</span>` : `<span class="badge warning">${escapeHtml(billing.planName)} · terminé</span>`;
}

function featuresLine(billing) {
  if (!billing?.isCustom || !billing.features) return "";
  const parts = [];
  if (billing.features.broadcasts) parts.push("messages groupés");
  if (billing.features.followUps) parts.push("relances");
  parts.push(billing.features.teamMembers ? `${billing.features.teamMembers} employé${billing.features.teamMembers > 1 ? "s" : ""}` : "sans employé");
  return parts.join(" · ");
}

function cardMarkup(organization) {
  const billing = organization.billing;
  const used = billing?.messagesUsed ?? 0;
  const limit = billing?.messageLimit ?? 0;
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = percent >= 100 ? "danger" : percent >= 80 ? "warning" : "";
  const connected = organization.whatsapp?.status === "CONNECTED";
  const custom = Boolean(billing?.isCustom);
  return `
    <article class="card client-card${organization.platformSuspended ? " is-suspended" : ""}" data-client="${escapeHtml(organization.id)}">
      <div class="client-card-head">
        <div class="client-card-name">
          <h3>${escapeHtml(organization.name)}</h3>
          <p class="muted">${escapeHtml(organization.owner?.name || "")}${organization.owner?.email ? ` · ${escapeHtml(organization.owner.email)}` : ""}</p>
        </div>
        <div class="client-card-badges">
          ${planBadge(organization)}
          ${organization.platformSuspended ? '<span class="badge danger">Suspendu</span>' : ""}
        </div>
      </div>
      <div class="client-card-usage">
        <div class="progress ${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="Messages utilisés"><span style="width:${percent}%"></span></div>
        <p class="muted"><span>${count(used)} / ${count(limit)} messages${custom || billing?.plan !== "trial" ? " ce mois-ci" : ""}</span>${custom ? `<span>${escapeHtml(featuresLine(billing))}</span>` : ""}</p>
      </div>
      <div class="client-card-foot">
        <span class="client-card-wa ${connected ? "is-on" : ""}">${icon("whatsapp", "icon-sm")}${connected ? "WhatsApp connecté" : "WhatsApp non connecté"}${organization.whatsapp?.phoneNumber ? ` · ${escapeHtml(formatPhone(organization.whatsapp.phoneNumber))}` : ""}</span>
        <span class="muted">Inscrit ${escapeHtml(formatRelativeTime(organization.createdAt))}</span>
      </div>
      <div class="client-card-actions">
        <button type="button" class="btn btn-sm ${custom ? "btn-primary" : "btn-secondary"}" data-client-plan="${escapeHtml(organization.id)}">${icon("sliders", "icon-sm")}${custom ? "Régler la formule" : "Passer en sur mesure"}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-client-suspend="${escapeHtml(organization.id)}">${icon(organization.platformSuspended ? "play" : "pause", "icon-sm")}${organization.platformSuspended ? "Réactiver" : "Suspendre"}</button>
      </div>
    </article>`;
}

function render() {
  const query = ($("#clients-search")?.value || "").trim().toLowerCase();
  const visible = organizations.filter((organization) => {
    if (filter !== "all" && kindOf(organization) !== filter) return false;
    if (!query) return true;
    return [organization.name, organization.owner?.name, organization.owner?.email].some((value) => (value || "").toLowerCase().includes(query));
  });
  const customs = organizations.filter((organization) => kindOf(organization) === "custom").length;
  $("#clients-summary").textContent = `${count(organizations.length)} entreprise${organizations.length > 1 ? "s" : ""}, dont ${count(customs)} sur mesure`;
  $("#clients-list").innerHTML = visible.length
    ? visible.map(cardMarkup).join("")
    : `<div class="empty"><span class="empty-icon">${icon("users")}</span><p class="empty-title">${organizations.length ? "Aucun client ne correspond" : "Aucune entreprise pour le moment"}</p><p class="empty-text">${organizations.length ? "Changez la recherche ou le filtre." : "Créez votre premier client sur mesure avec le bouton en haut de la page."}</p></div>`;
}

export async function loadClients() {
  try {
    const data = await api("/admin/organizations");
    organizations = data.organizations || [];
    render();
  } catch (error) {
    $("#clients-list").innerHTML = `<div class="empty"><span class="empty-icon">${icon("alert")}</span><p class="empty-title">Liste indisponible</p><p class="empty-text">${escapeHtml(error.message || "Impossible de charger les clients.")}</p></div>`;
  }
}

/* ------------------------------------------------------------ champs de la formule */

function planFieldsMarkup(prefix, plan) {
  const options = Array.from({ length: MAX_EMPLOYEES + 1 }, (_, value) => `<option value="${value}"${value === plan.teamMembers ? " selected" : ""}>${value === 0 ? "Aucun" : value}</option>`).join("");
  return `
    <label class="field">
      <span class="field-label">Messages de l'agent par mois</span>
      <input id="${prefix}-limit" type="number" inputmode="numeric" min="1" max="1000000" step="1" required value="${plan.messageLimit}" />
      <span class="hint">Au-delà, l'agent se tait jusqu'au mois suivant ; le client et vous êtes prévenus par email. Le compteur repart à zéro tous les 30 jours.</span>
    </label>
    <label class="switch">
      <input id="${prefix}-broadcasts" type="checkbox"${plan.broadcasts ? " checked" : ""} />
      <span class="switch-track" aria-hidden="true"></span>
      <span class="info-switch-text"><b>Messages groupés</b><small>Envoyer une annonce à plusieurs clients d'un coup.</small></span>
    </label>
    <label class="switch">
      <input id="${prefix}-followups" type="checkbox"${plan.followUps ? " checked" : ""} />
      <span class="switch-track" aria-hidden="true"></span>
      <span class="info-switch-text"><b>Relances automatiques</b><small>L'agent relance les clients intéressés qui ne répondent plus.</small></span>
    </label>
    <label class="field">
      <span class="field-label">Employés autorisés</span>
      <select id="${prefix}-team">${options}</select>
      <span class="hint">En plus du gérant. ${MAX_EMPLOYEES} au maximum.</span>
    </label>`;
}

function readPlan(prefix) {
  return {
    messageLimit: Number.parseInt($(`#${prefix}-limit`).value, 10),
    broadcasts: $(`#${prefix}-broadcasts`).checked,
    followUps: $(`#${prefix}-followups`).checked,
    teamMembers: Number.parseInt($(`#${prefix}-team`).value, 10),
  };
}

/* ------------------------------------------------------------ création */

function newPassword() {
  // Sans caractères ambigus (0/O, 1/l) : il sera recopié ou dicté au client.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function openCreate() {
  const form = $("#client-create-form");
  form.reset();
  form.classList.remove("hidden");
  $("#client-created").classList.add("hidden");
  $("#client-created").innerHTML = "";
  $('[data-plan-fields="create"]').innerHTML = planFieldsMarkup("client-create", DEFAULT_PLAN);
  $("#client-password").value = newPassword();
  $("#client-create-submit").disabled = false;
  openDrawer($("#client-create-drawer"), { focus: "#client-company" });
}

function createdMarkup(client, password) {
  const loginUrl = new URL("./", window.location.href).href.split("#")[0];
  const message = `Bonjour ${client.owner.name},\n\nVotre espace Brayano IA est prêt.\nAdresse : ${loginUrl}\nEmail : ${client.owner.email}\nMot de passe provisoire : ${password}\n\nVous pourrez le changer avec « Mot de passe oublié ? » sur la page de connexion.`;
  return `
    <div class="alert success">${icon("check-circle")}<div class="alert-body"><p class="alert-title">${escapeHtml(client.name)} est créé</p><p>Formule sur mesure active : ${count(client.billing.messageLimit)} messages par mois. Remettez ces identifiants au client.</p></div></div>
    <div class="client-credentials">
      <p><span class="muted">Adresse</span><b>${escapeHtml(loginUrl)}</b></p>
      <p><span class="muted">Email</span><b>${escapeHtml(client.owner.email)}</b></p>
      <p><span class="muted">Mot de passe provisoire</span><b>${escapeHtml(password)}</b></p>
    </div>
    <div class="client-created-actions">
      <button type="button" class="btn btn-primary" id="client-copy">${icon("copy", "icon-sm")}Copier le message pour le client</button>
      <button type="button" class="btn btn-secondary" data-drawer-close>Fermer</button>
    </div>
    <textarea id="client-copy-text" class="sr-only" aria-hidden="true" tabindex="-1">${escapeHtml(message)}</textarea>`;
}

async function submitCreate(event) {
  event.preventDefault();
  if (saving) return;
  const plan = readPlan("client-create");
  if (!Number.isInteger(plan.messageLimit) || plan.messageLimit < 1) return showToast("Indiquez une limite de messages d'au moins 1.", "error");
  const password = $("#client-password").value;
  const payload = {
    companyName: $("#client-company").value.trim(),
    ownerName: $("#client-owner").value.trim(),
    email: $("#client-email").value.trim(),
    password,
    whatsappNumber: $("#client-whatsapp").value.trim() || undefined,
    plan,
  };
  saving = true;
  $("#client-create-submit").disabled = true;
  try {
    const { client } = await api("/admin/organizations", { method: "POST", body: JSON.stringify(payload) });
    $("#client-create-form").classList.add("hidden");
    const box = $("#client-created");
    box.innerHTML = createdMarkup(client, password);
    box.classList.remove("hidden");
    $("#client-copy").onclick = async () => {
      const text = $("#client-copy-text").value;
      try {
        await navigator.clipboard.writeText(text);
        showToast("Message copié : collez-le dans WhatsApp pour le client.", "success");
      } catch {
        showToast("Copie impossible : recopiez les identifiants affichés.", "error");
      }
    };
    await loadClients();
  } catch (error) {
    $("#client-create-submit").disabled = false;
    showToast(error.message || "Création impossible.", "error");
  } finally {
    saving = false;
  }
}

/* ------------------------------------------------------------ réglage de la formule */

function openPlan(organizationId) {
  const organization = organizations.find((item) => item.id === organizationId);
  if (!organization) return;
  editing = organization;
  const billing = organization.billing;
  const custom = Boolean(billing?.isCustom);
  const plan = custom
    ? { messageLimit: billing.messageLimit, broadcasts: Boolean(billing.features?.broadcasts), followUps: Boolean(billing.features?.followUps), teamMembers: billing.features?.teamMembers ?? 0 }
    : DEFAULT_PLAN;
  $("#client-plan-title").textContent = custom ? "Régler la formule sur mesure" : "Passer en formule sur mesure";
  $("#client-plan-subtitle").textContent = organization.name;
  $("#client-plan-notice").innerHTML = custom
    ? ""
    : `<div class="alert warning">${icon("info")}<div class="alert-body">${billing?.plan === "trial" ? "Ce client est en essai gratuit." : `Ce client a le forfait ${escapeHtml(billing?.planName || "")} payé en ligne.`} En passant en sur mesure, il ne paie plus dans l'application et son compteur de messages repart à zéro.</div></div>`;
  $('[data-plan-fields="edit"]').innerHTML = planFieldsMarkup("client-plan", plan);
  $("#client-plan-remove-box").classList.toggle("hidden", !custom);
  $("#client-plan-submit").textContent = custom ? "Enregistrer la formule" : "Passer en sur mesure";
  $("#client-plan-submit").disabled = false;
  openDrawer($("#client-plan-drawer"), { focus: "#client-plan-limit" });
}

async function submitPlan(event) {
  event.preventDefault();
  if (!editing || saving) return;
  const plan = readPlan("client-plan");
  if (!Number.isInteger(plan.messageLimit) || plan.messageLimit < 1) return showToast("Indiquez une limite de messages d'au moins 1.", "error");
  saving = true;
  $("#client-plan-submit").disabled = true;
  try {
    await api(`/admin/organizations/${encodeURIComponent(editing.id)}/custom-plan`, { method: "PUT", body: JSON.stringify(plan) });
    showToast(`Formule de ${editing.name} enregistrée.`, "success");
    await closeDrawer($("#client-plan-drawer"), { force: true });
    await loadClients();
  } catch (error) {
    $("#client-plan-submit").disabled = false;
    showToast(error.message || "Enregistrement impossible.", "error");
  } finally {
    saving = false;
  }
}

async function removePlan() {
  if (!editing) return;
  const organization = editing;
  const ok = await confirmDialog({
    title: `Rendre ${organization.name} aux forfaits ?`,
    message: "Sa formule sur mesure s'arrête tout de suite. Pour que son agent réponde, il devra payer un forfait en ligne depuis « Mon forfait ».",
    confirmLabel: "Rendre aux forfaits",
    tone: "danger",
  });
  if (!ok) return;
  try {
    await api(`/admin/organizations/${encodeURIComponent(organization.id)}/custom-plan`, { method: "DELETE" });
    showToast(`${organization.name} est rendu aux forfaits.`, "success");
    await closeDrawer($("#client-plan-drawer"), { force: true });
    await loadClients();
  } catch (error) {
    showToast(error.message || "Opération impossible.", "error");
  }
}

/* ------------------------------------------------------------ suspension */

async function toggleSuspension(organizationId) {
  const organization = organizations.find((item) => item.id === organizationId);
  if (!organization) return;
  const suspending = !organization.platformSuspended;
  const ok = await confirmDialog({
    title: suspending ? `Suspendre ${organization.name} ?` : `Réactiver ${organization.name} ?`,
    message: suspending
      ? "Son agent ne répond plus à aucun client et un bandeau l'en informe dans son tableau de bord. Utile quand un client sur mesure ne vous a pas payé."
      : "Son agent recommence à répondre à ses clients.",
    confirmLabel: suspending ? "Suspendre" : "Réactiver",
    tone: suspending ? "danger" : "primary",
  });
  if (!ok) return;
  try {
    await api(`/admin/organizations/${encodeURIComponent(organizationId)}/${suspending ? "suspend" : "unsuspend"}`, { method: "POST", body: JSON.stringify({}) });
    showToast(suspending ? `${organization.name} est suspendu.` : `${organization.name} est réactivé.`, "success");
    await loadClients();
  } catch (error) {
    showToast(error.message || "Opération impossible.", "error");
  }
}

export function initClients() {
  if (!$("#clients-view")) return;
  $("#clients-new").onclick = openCreate;
  $("#client-password-new").onclick = () => { $("#client-password").value = newPassword(); };
  $("#client-create-form").onsubmit = submitCreate;
  $("#client-plan-form").onsubmit = submitPlan;
  $("#client-plan-remove").onclick = () => void removePlan();
  $("#clients-search").addEventListener("input", debounce(render, 150));
  $$("[data-clients-filter]").forEach((button) => {
    button.onclick = () => {
      filter = button.dataset.clientsFilter;
      $$("[data-clients-filter]").forEach((item) => item.classList.toggle("active", item === button));
      render();
    };
  });
  $("#clients-list").addEventListener("click", (event) => {
    const planButton = event.target.closest("[data-client-plan]");
    if (planButton) return openPlan(planButton.dataset.clientPlan);
    const suspendButton = event.target.closest("[data-client-suspend]");
    if (suspendButton) return void toggleSuspension(suspendButton.dataset.clientSuspend);
  });
  // Le bouton « Fermer » du récapitulatif est créé après coup : on écoute au niveau du panneau.
  $("#client-create-drawer").addEventListener("click", (event) => {
    if (event.target.closest("#client-created [data-drawer-close]")) void closeDrawer($("#client-create-drawer"), { force: true });
  });
}
