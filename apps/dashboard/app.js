const DEFAULT_API = "https://brayano-ia-5.onrender.com";
const API = window.API_BASE_URL || localStorage.getItem("brayano_api") || DEFAULT_API;
let orgId = localStorage.getItem("brayano_org");
let conversations = [];
let commercialMetrics = [];
let currentOrganizationName = "Brayano";
let pendingRegistrationEmail = "";
let editingResponsibleId = null;
let agentTestHistory = [];
const $ = (selector) => document.querySelector(selector);
const showToast = (message) => { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2800); };

function updateRealtimeHeader() {
  const dateLabel = document.getElementById("overview-date");
  const greetingLabel = document.getElementById("company-greeting");
  const orgName = $("#org-select")?.selectedOptions?.[0]?.textContent || currentOrganizationName || "Entreprise";

  if (dateLabel) {
    const now = new Date();
    const formattedDate = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(now);
    const formattedTime = new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);
    dateLabel.textContent = `${formattedDate.toUpperCase()} • ${formattedTime}`;
  }

  if (greetingLabel) {
    greetingLabel.textContent = orgName || "Bienvenue";
  }
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem("brayano_session") || "null");
  } catch {
    return null;
  }
}

function isAuthenticated() {
  const session = getSession();
  return !!session?.email && !!session?.token;
}

async function authenticateUser(email, password) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const response = await api("/login", {
    method: "POST",
    body: JSON.stringify({ email: normalizedEmail, password }),
  });

  localStorage.setItem("brayano_session", JSON.stringify({
    email: response.user.email,
    token: response.token,
    organizationId: response.organizationId || null,
  }));

  if (response.organizationId) {
    localStorage.setItem("brayano_org", response.organizationId);
    orgId = response.organizationId;
  }

  return true;
}

function logoutUser(mode = "login") {
  localStorage.removeItem("brayano_session");
  $(".app-shell").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
  $("#login-email").value = "";
  $("#login-password").value = "";
  $("#register-name").value = "";
  $("#register-company").value = "";
  $("#register-email").value = "";
  $("#register-password").value = "";
  $("#register-verification-code").value = "";
  showAuthMode(mode);
}

function showDashboard() {
  $("#login-screen").classList.add("hidden");
  $(".app-shell").classList.remove("hidden");
}

function showAuthMode(mode) {
  const loginForm = $("#login-form");
  const registerForm = $("#register-form");
  const verificationForm = $("#register-verification-form");
  const toggleButton = $("#toggle-auth-mode");
  const authTitle = $("#auth-title");
  const authHint = $("#auth-mode-hint");

  if (!loginForm || !registerForm || !toggleButton || !authTitle || !authHint) return;

  const isLogin = mode === "login";
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
  verificationForm?.classList.add("hidden");
  authTitle.textContent = isLogin ? "Connexion à l'espace de pilotage" : "Créer mon espace client";
  authHint.textContent = isLogin ? "Connectez-vous avec votre compte." : "Créez votre entreprise et votre compte administrateur.";
  toggleButton.textContent = isLogin ? "Créer un compte" : "Se connecter";
}

function initAuthFlow() {
  const loginForm = $("#login-form");
  const registerForm = $("#register-form");
  const verificationForm = $("#register-verification-form");
  const toggleButton = $("#toggle-auth-mode");

  if (!loginForm || !registerForm || !verificationForm || !toggleButton) return;

  toggleButton.onclick = () => {
    const isLoginHidden = $("#login-form").classList.contains("hidden");
    showAuthMode(isLoginHidden ? "login" : "register");
  };

  loginForm.onsubmit = async (event) => {
    event.preventDefault();
    const email = $("#login-email").value;
    const password = $("#login-password").value;

    try {
      await authenticateUser(email, password);
      showDashboard();
      showToast("Connexion réussie.");
      loadOrganizations().catch((error) => showToast(`API inaccessible : ${error.message}`));
    } catch (error) {
      showToast(error.message || "Email ou mot de passe incorrect.");
    }
  };

  registerForm.onsubmit = async (event) => {
    event.preventDefault();

    try {
      const payload = {
        name: $("#register-name").value,
        companyName: $("#register-company").value,
        email: $("#register-email").value,
        password: $("#register-password").value,
      };

      const result = await api("/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (result.verificationRequired) {
        pendingRegistrationEmail = result.email;
        registerForm.classList.add("hidden");
        verificationForm.classList.remove("hidden");
        $("#auth-title").textContent = "Vérifier votre adresse email";
        $("#auth-mode-hint").textContent = "Saisissez le code reçu par email.";
        $("#toggle-auth-mode").classList.add("hidden");
        startResendCountdown();
        showToast(result.message);
        return;
      }

      localStorage.setItem("brayano_session", JSON.stringify({ email: result.user.email, token: result.token }));
      localStorage.setItem("brayano_org", result.organizationId);
      showDashboard();
      showToast("Compte créé avec succès.");
      loadOrganizations().catch((error) => showToast(`API inaccessible : ${error.message}`));
    } catch (error) {
      showToast(error.message || "Impossible de créer votre compte.");
    }
  };

  verificationForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const result = await api("/register/verify", { method: "POST", body: JSON.stringify({ email: pendingRegistrationEmail, code: $("#register-verification-code").value }) });
      localStorage.setItem("brayano_session", JSON.stringify({ email: result.user.email, token: result.token, organizationId: result.organizationId }));
      localStorage.setItem("brayano_org", result.organizationId);
      orgId = result.organizationId;
      showDashboard();
      showToast("Compte créé avec succès.");
      loadOrganizations().catch((error) => showToast(`API inaccessible : ${error.message}`));
    } catch (error) {
      showToast(error.message || "Code incorrect.");
    }
  };

  $("#resend-registration-code").onclick = async () => {
    try {
      const result = await api("/register/resend", { method: "POST", body: JSON.stringify({ email: pendingRegistrationEmail }) });
      showToast(result.message);
      startResendCountdown();
    } catch (error) {
      showToast(error.message);
    }
  };

  $("#connect-wa").onclick = connectWhatsApp;
  $("#disconnect-wa").onclick = disconnectWhatsApp;

  if (isAuthenticated()) {
    showDashboard();
    api("/me").then((me) => {
      const session = getSession();
      const nextSession = { ...session, organizationId: me.organizationId || session?.organizationId || null };
      localStorage.setItem("brayano_session", JSON.stringify(nextSession));
      if (nextSession.organizationId) {
        orgId = nextSession.organizationId;
        localStorage.setItem("brayano_org", orgId);
      }
      loadOrganizations().catch((error) => showToast(`API inaccessible : ${error.message}`));
    }).catch((error) => {
      const message = (error && error.message) || "";
      if (message.includes("Failed to fetch") || message.includes("fetch") || message.includes("Network")) {
        showToast("Serveur indisponible. Réessayez plus tard.");
        return;
      }

      logoutUser();
      showToast("Session expirée. Veuillez vous reconnecter.");
    });
  }
}

function startResendCountdown() {
  const button = $("#resend-registration-code");
  if (!button) return;
  let remaining = 60;
  button.disabled = true;
  button.textContent = `Renvoyer le code (${remaining}s)`;
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      button.disabled = false;
      button.textContent = "Renvoyer le code";
      return;
    }
    button.textContent = `Renvoyer le code (${remaining}s)`;
  }, 1000);
}
async function api(path, options = {}) {
  const requestHeaders = new Headers(options.headers || {});
  const session = getSession();
  if (session?.token) {
    requestHeaders.set("Authorization", `Bearer ${session.token}`);
  }

  const hasBody = options.body !== undefined && options.body !== null && options.body !== "";
  if (hasBody && !requestHeaders.has("Content-Type") && !(options.body instanceof FormData)) {
    requestHeaders.set("Content-Type", "application/json");
  }

  let response;
  try {
    response = await fetch(`${API}${path}`, { ...options, headers: requestHeaders });
  } catch (error) {
    throw new Error("Failed to fetch");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error((typeof payload === "string" ? payload : payload.message) || "La requête a échoué.");
  }

  if (response.status === 204) return null;
  return typeof payload === "string" ? payload : payload;
}
function initials(name = "?") { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function formatTime(date) { return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(date)); }
function setView(view) { document.querySelectorAll(".view").forEach((item) => item.classList.toggle("hidden", item.id !== `${view}-view`)); document.querySelectorAll(".nav-item[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view)); if (view === "inbox") renderInbox(); if (view === "agent") loadSettings(); if (view === "settings") { loadDelaySettings(); loadRoutingConfig(); } if (view === "whatsapp") loadWhatsApp(); }

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

function renderCommercialMetrics() {
  const list = $("#commercial-metrics-list");
  if (!list) return;

  const period = $("#commercial-period")?.value || "today";
  const sortedMetrics = [...commercialMetrics]
    .map((entry) => ({
      ...entry,
      visibleCount: countMessagesForPeriod(entry, period),
    }))
    .sort((a, b) => b.visibleCount - a.visibleCount);

  if (!sortedMetrics.length) {
    list.innerHTML = '<div class="empty-state">Aucun commercial configuré pour le moment.</div>';
    return;
  }

  list.innerHTML = sortedMetrics.map((entry) => {
    const badgeTone = entry.visibleCount > 0 ? "positive" : "neutral";
    const latestEntry = entry.messagesByDay[0];
    const latestDay = latestEntry ? new Date(`${latestEntry.day}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "Aucun";
    return `
      <div class="commercial-item">
        <div class="commercial-head">
          <div class="commercial-avatar">${initials(entry.name)}</div>
          <div>
            <strong>${entry.name}</strong>
            <small>${entry.locationName}</small>
          </div>
        </div>
        <div class="commercial-stats">
          <span class="metric-count ${badgeTone}">${entry.visibleCount}</span>
          <span class="commercial-label">messages</span>
        </div>
        <div class="commercial-meta">Dernier message : ${latestDay}</div>
      </div>
    `;
  }).join("");
}

async function loadCommercialMetrics() {
  try {
    const { commercialMetrics: metrics = [] } = await api(`/organizations/${orgId}/routing/commercial-metrics`);
    commercialMetrics = metrics;
    renderCommercialMetrics();
  } catch (error) {
    console.error(error);
  }
}

async function loadOrganizations() {
  const data = await api("/organizations");
  const select = $("#org-select");
  const orgPicker = $(".org-picker");
  const session = getSession();
  const organizations = data.organizations || [];
  const availableOrgId = session?.organizationId || orgId;

  if (!organizations.length) {
    if (orgPicker) orgPicker.classList.add("hidden");
    return;
  }

  const filteredOrganizations = availableOrgId
    ? organizations.filter((org) => org.id === availableOrgId)
    : organizations;

  const visibleOrganizations = filteredOrganizations.length ? filteredOrganizations : organizations;

  if (orgPicker) {
    orgPicker.classList.toggle("hidden", visibleOrganizations.length <= 1);
  }

  select.innerHTML = visibleOrganizations.map((org) => `<option value="${org.id}">${org.name}</option>`).join("");

  if (!visibleOrganizations.length) {
    select.innerHTML = "<option>Aucune entreprise</option>";
    return;
  }

  orgId = visibleOrganizations.some((org) => org.id === availableOrgId) ? availableOrgId : visibleOrganizations[0].id;
  currentOrganizationName = visibleOrganizations.find((org) => org.id === orgId)?.name || visibleOrganizations[0].name || "Brayano";
  localStorage.setItem("brayano_org", orgId);
  select.value = orgId;
  select.onchange = () => {
    orgId = select.value;
    currentOrganizationName = organizations.find((org) => org.id === orgId)?.name || "Brayano";
    localStorage.setItem("brayano_org", orgId);
    updateRealtimeHeader();
    refresh();
  };
  updateRealtimeHeader();
  refresh();
}
function getConversationStatusLabel(item) {
  if (item.status === "CLOSED") return "Fermée";
  if (item.status === "HUMAN_HANDOFF") return "Handoff humain";
  if (!item.aiEnabled) return "IA désactivée";
  return "Actif";
}

async function refresh() {
  const org = $("#org-select").selectedOptions[0]?.textContent || "Brayano";
  $("#current-org").textContent = org;
  $("#org-initial").textContent = org[0]?.toUpperCase() || "B";
  updateRealtimeHeader();

  try {
    const [list, status, metrics] = await Promise.all([
      api(`/organizations/${orgId}/conversations`),
      api(`/organizations/${orgId}/whatsapp/status`),
      api(`/organizations/${orgId}/routing/commercial-metrics`),
    ]);

    conversations = list.conversations || [];
    commercialMetrics = metrics.commercialMetrics || [];

    const activeConversationCount = conversations.filter((item) => item.status !== "CLOSED").length;
    $("#metric-active").textContent = activeConversationCount;
    $("#metric-messages").textContent = conversations.reduce((count, item) => count + (item.messages?.length || 0), 0);
    updateWhatsAppMetric(status.status);
    renderCommercialMetrics();
    renderRecent();
    $("#nav-count").textContent = activeConversationCount;
  } catch (error) {
    showToast(error.message);
  }
}
function updateWhatsAppMetric(status) { const connected = status === "CONNECTED"; $("#metric-whatsapp").textContent = connected ? "Connecté" : "Déconnecté"; $("#metric-whatsapp").style.color = connected ? "var(--green)" : "var(--orange)"; $("#metric-phone").textContent = connected ? "Numéro opérationnel" : "Connexion requise"; }
function conversationMarkup(item) { const name = item.contact?.displayName || item.contact?.whatsappJid || "Contact"; const last = item.messages?.[item.messages.length - 1]; const statusLabel = getConversationStatusLabel(item); return `<div class="conversation-row" data-id="${item.id}"><span class="contact-avatar">${initials(name)}</span><div class="conversation-main"><strong>${name}</strong><p>${last?.content || "Aucun message"}</p></div><div class="conversation-meta">${last ? formatTime(last.createdAt) : ""}<span class="unread">${statusLabel}</span></div></div>`; }
function renderRecent() { const target = $("#recent-conversations"); target.innerHTML = conversations.length ? conversations.slice(0, 4).map(conversationMarkup).join("") : '<div class="empty-state">Aucune conversation pour le moment.</div>'; target.querySelectorAll(".conversation-row").forEach((row) => row.onclick = () => openConversation(row.dataset.id)); }
function renderInbox() { $("#inbox-total").textContent = `${conversations.length} conversation${conversations.length > 1 ? "s" : ""}`; const target = $("#all-conversations"); target.innerHTML = conversations.length ? conversations.map(conversationMarkup).join("") : '<div class="empty-state">Aucune conversation pour le moment.</div>'; target.querySelectorAll(".conversation-row").forEach((row) => row.onclick = () => openConversation(row.dataset.id)); }
async function openConversation(id) { try { const data = await api(`/organizations/${orgId}/conversations/${id}`); const conversation = data.conversation; const name = conversation.contact?.displayName || conversation.contact?.whatsappJid || "Contact"; const statusLabel = conversation.status === "CLOSED" ? "Conversation fermée" : conversation.status === "HUMAN_HANDOFF" ? "En attente d'un humain" : conversation.aiEnabled ? "Agent IA actif" : "Prise en main humaine"; $("#conversation-detail").innerHTML = `<div class="panel-heading"><div><h2>${name}</h2><p class="muted">${statusLabel}</p></div><button class="ghost-button" id="toggle-ai">${conversation.aiEnabled ? "Désactiver l'IA" : "Réactiver l'IA"}</button></div><div class="messages">${(conversation.messages || []).map((message) => `<div style="padding:10px 13px;margin:8px 0;max-width:75%;border-radius:10px;background:${message.author === "CONTACT" ? "#f3f4f8" : "#f0edff"};margin-left:${message.author === "CONTACT" ? "0" : "auto"};font-size:12px">${message.content}</div>`).join("")}</div><form id="reply-form" style="display:flex;gap:8px;margin-top:22px"><input required placeholder="Écrire une réponse..." style="flex:1;border:1px solid var(--line);border-radius:8px;padding:11px" /><button class="primary">Envoyer</button></form>`; $("#toggle-ai").onclick = () => toggleAi(id, conversation.aiEnabled); $("#reply-form").onsubmit = (event) => reply(event, id); } catch (error) { showToast(error.message); } }
async function reply(event, id) { event.preventDefault(); const input = event.target.querySelector("input"); try { await api(`/organizations/${orgId}/conversations/${id}/reply`, { method: "POST", body: JSON.stringify({ text: input.value }) }); input.value = ""; showToast("Réponse envoyée"); await refresh(); await openConversation(id); } catch (error) { showToast(error.message); } }
async function toggleAi(id, enabled) { try { await api(`/organizations/${orgId}/conversations/${id}/ai/${enabled ? "disable" : "enable"}`, { method: "POST" }); showToast(enabled ? "IA désactivée" : "IA réactivée"); await refresh(); await openConversation(id); } catch (error) { showToast(error.message); } }
async function loadSettings() { try { const { settings } = await api(`/organizations/${orgId}/ai-settings`); const qualificationFields = settings.qualificationFields || []; $("#agent-name").value = settings.agentName || ""; $("#business-info").value = settings.businessInfo || ""; $("#system-prompt").value = settings.systemPrompt || ""; $("#welcome-message").value = settings.welcomeMessage || ""; document.querySelectorAll('input[name="qualification-field"]').forEach((input) => { input.checked = qualificationFields.includes(input.value); }); $("#custom-qualification-fields").value = qualificationFields.filter((field) => !["name", "city", "need", "budget", "product", "urgency", "quartier"].includes(field)).join(", "); } catch (error) { showToast(error.message); } }
async function saveSettings(event) { event.preventDefault(); try { const standardFields = [...document.querySelectorAll('input[name="qualification-field"]:checked')].map((input) => input.value); const customFields = $("#custom-qualification-fields").value.split(",").map((field) => field.trim().toLowerCase()).filter(Boolean); const qualificationFields = [...new Set([...standardFields, ...customFields])]; await api(`/organizations/${orgId}/ai-settings`, { method: "PUT", body: JSON.stringify({ agentName: $("#agent-name").value, businessInfo: $("#business-info").value, systemPrompt: $("#system-prompt").value, welcomeMessage: $("#welcome-message").value, qualificationFields }) }); showToast("Configuration enregistrée"); } catch (error) { showToast(error.message); } }
function renderAgentTestHistory() {
  const container = $("#agent-test-messages");
  if (!agentTestHistory.length) {
    container.innerHTML = '<div class="empty-state">Écrivez un premier message pour simuler un prospect.</div>';
    return;
  }

  container.innerHTML = "";
  agentTestHistory.forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = `agent-test-bubble ${message.role === "user" ? "prospect" : "agent"}`;
    bubble.textContent = message.content;
    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

function clearAgentTest() {
  agentTestHistory = [];
  $("#agent-test-result").classList.add("hidden");
  renderAgentTestHistory();
}

async function testAgentReply(event) {
  event.preventDefault();
  const input = $("#agent-test-input");
  const button = $("#agent-test-send");
  const message = input.value.trim();
  if (!message) return;

  button.disabled = true;
  input.disabled = true;
  agentTestHistory.push({ role: "user", content: message });
  renderAgentTestHistory();
  input.value = "";

  try {
    const result = await api(`/organizations/${orgId}/ai-test/reply`, {
      method: "POST",
      body: JSON.stringify({ message, history: agentTestHistory.slice(0, -1) }),
    });
    agentTestHistory.push({ role: "assistant", content: result.reply });
    renderAgentTestHistory();
    const resultPanel = $("#agent-test-result");
    resultPanel.classList.remove("hidden");
    resultPanel.textContent = `Qualification : ${result.qualificationStatus} | Score : ${result.leadScore}/100 | Action : ${result.nextAction}`;
  } catch (error) {
    agentTestHistory.pop();
    renderAgentTestHistory();
    showToast(error.message || "Impossible de tester l'agent.");
  } finally {
    button.disabled = false;
    input.disabled = false;
    input.focus();
  }
}
async function loadDelaySettings() {
  try {
    const { settings } = await api(`/organizations/${orgId}/ai-settings`);
    const delay = [3, 5, 7, 60, 120].includes(settings.responseDelaySeconds) ? settings.responseDelaySeconds : 3;
    const option = document.querySelector(`input[name="response-delay"][value="${delay}"]`);
    if (option) option.checked = true;
  } catch (error) {
    showToast(error.message);
  }
}
async function saveDelaySettings(event) {
  event.preventDefault();
  const selected = document.querySelector('input[name="response-delay"]:checked');
  const responseDelaySeconds = Number(selected?.value || 3);
  try {
    await api(`/organizations/${orgId}/ai-settings`, {
      method: "PUT",
      body: JSON.stringify({ responseDelaySeconds }),
    });
    showToast(`Délai enregistré : ${responseDelaySeconds >= 60 ? `${responseDelaySeconds / 60} minute(s)` : `${responseDelaySeconds} secondes`}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function loadRoutingConfig() {
  try {
    const { locations = [], settings = null } = await api(`/organizations/${orgId}/routing`);
    const list = $("#routing-locations-list");
    const locationSelect = $("#responsible-location");
    const fallbackSelect = $("#fallback-responsible");

    if (!list) return;

    if (locationSelect) {
      locationSelect.innerHTML = locations.length
        ? locations.map((location) => `<option value="${location.id}">${location.name} — ${location.city}</option>`).join("")
        : '<option value="">Aucune zone disponible</option>';
    }

    if (!locations.length) {
      list.innerHTML = '<div class="empty-state">Aucune zone configurée pour le moment.</div>';
    } else {
      list.innerHTML = locations.map((location) => {
        const responsible = (location.responsible || []).map((person) => `
          <li class="routing-responsible">
            <span>${person.name} — ${person.whatsappNumber}${person.active ? "" : " (inactif)"}</span>
            <span class="routing-actions">
              <button type="button" class="text-button" data-edit-responsible="${person.id}">Modifier</button>
              <button type="button" class="text-button danger-text" data-delete-responsible="${person.id}">Supprimer</button>
            </span>
          </li>
        `).join("") || "<li>Aucun responsable</li>";
        return `
          <div class="routing-item">
            <div>
              <strong>${location.name}</strong>
              <small>${location.city}</small>
            </div>
            <ul>${responsible}</ul>
          </div>
        `;
      }).join("");

      list.querySelectorAll("[data-edit-responsible]").forEach((button) => {
        button.onclick = () => startResponsibleEdit(button.dataset.editResponsible, locations);
      });
      list.querySelectorAll("[data-delete-responsible]").forEach((button) => {
        button.onclick = () => deleteResponsibleConfig(button.dataset.deleteResponsible);
      });
    }

    if (fallbackSelect) {
      fallbackSelect.innerHTML = '<option value="">Aucun responsable</option>' +
        locations.flatMap((location) => (location.responsible || []).filter((person) => person.active).map((person) => `<option value="${person.id}">${person.name} — ${location.name}</option>`)).join("");
      fallbackSelect.value = settings?.fallbackResponsibleId || "";
    }

    const fallbackInput = $("#fallback-whatsapp");
    if (fallbackInput) fallbackInput.value = settings?.fallbackWhatsApp || "";
  } catch (error) {
    showToast(error.message || "Impossible de charger la configuration de routage.");
  }
}

function resetResponsibleForm() {
  editingResponsibleId = null;
  $("#responsible-form").reset();
  $("#responsible-active").checked = true;
  $("#responsible-id").value = "";
  $("#responsible-form button[type=submit]").textContent = "Enregistrer le responsable";
  $("#cancel-responsible-edit").classList.add("hidden");
}

function startResponsibleEdit(responsibleId, locations) {
  const person = locations.flatMap((location) => location.responsible || []).find((entry) => entry.id === responsibleId);
  if (!person) return;

  editingResponsibleId = person.id;
  $("#responsible-id").value = person.id;
  $("#responsible-location").value = person.locationId;
  $("#responsible-name").value = person.name;
  $("#responsible-whatsapp").value = person.whatsappNumber;
  $("#responsible-active").checked = person.active;
  $("#responsible-form button[type=submit]").textContent = "Enregistrer les modifications";
  $("#cancel-responsible-edit").classList.remove("hidden");
  $("#responsible-form").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteResponsibleConfig(responsibleId) {
  const confirmed = window.confirm("Supprimer définitivement ce commercial ? Les anciens prospects seront conservés, mais ne seront plus liés à ce commercial.");
  if (!confirmed) return;

  try {
    await api(`/organizations/${orgId}/responsibles/${responsibleId}`, { method: "DELETE" });
    if (editingResponsibleId === responsibleId) resetResponsibleForm();
    showToast("Commercial supprimé définitivement.");
    await loadRoutingConfig();
  } catch (error) {
    showToast(error.message || "Impossible de supprimer le commercial.");
  }
}

async function saveLocationConfig(event) {
  event.preventDefault();
  const payload = {
    name: $("#location-name").value,
    city: $("#location-city").value,
    recipientWhatsApp: $("#location-recipient-whatsapp").value,
    active: true,
  };

  try {
    await api(`/organizations/${orgId}/locations`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    $("#location-form").reset();
    showToast("Zone enregistrée.");
    loadRoutingConfig();
  } catch (error) {
    showToast(error.message || "Impossible d'enregistrer la zone.");
  }
}

async function saveResponsibleConfig(event) {
  event.preventDefault();
  const wasEditing = Boolean(editingResponsibleId);
  const payload = {
    locationId: $("#responsible-location").value,
    name: $("#responsible-name").value,
    whatsappNumber: $("#responsible-whatsapp").value,
    active: $("#responsible-active").checked,
  };

  try {
    await api(editingResponsibleId
      ? `/organizations/${orgId}/responsibles/${editingResponsibleId}`
      : `/organizations/${orgId}/responsibles`, {
      method: editingResponsibleId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    resetResponsibleForm();
    showToast(wasEditing ? "Commercial modifié." : "Responsable enregistré.");
    await loadRoutingConfig();
  } catch (error) {
    showToast(error.message || "Impossible d'enregistrer le responsable.");
  }
}

async function saveFallbackConfig(event) {
  event.preventDefault();
  const payload = {
    fallbackResponsibleId: $("#fallback-responsible").value || null,
    fallbackWhatsApp: $("#fallback-whatsapp").value || null,
    active: true,
  };

  try {
    await api(`/organizations/${orgId}/routing/fallback`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    showToast("Fallback enregistré.");
    loadRoutingConfig();
  } catch (error) {
    showToast(error.message || "Impossible d'enregistrer le fallback.");
  }
}

async function loadWhatsApp() { try { const { status } = await api(`/organizations/${orgId}/whatsapp/status`); const connected = status === "CONNECTED"; $("#wa-title").textContent = connected ? "WhatsApp connecté" : status === "QR_PENDING" ? "Scannez le QR code" : "WhatsApp déconnecté"; $("#qr-status").textContent = connected ? "Connecté" : status === "QR_PENDING" ? "QR disponible" : "En attente"; $("#qr-status").className = `pill ${connected ? "" : "warning"}`; $("#disconnect-wa").classList.toggle("hidden", !connected); if (status === "QR_PENDING") { const result = await api(`/organizations/${orgId}/whatsapp/qr`); $("#qr-container").innerHTML = `<img src="${result.qr}" alt="QR code WhatsApp" style="width:230px;height:230px" />`; } else if (!connected) { $("#qr-container").innerHTML = ""; } } catch (error) { showToast(error.message); } }
async function waitForWhatsAppStatus() { const deadline = Date.now() + 30000; while (Date.now() < deadline) { try { const { status } = await api(`/organizations/${orgId}/whatsapp/status`); if (status === "QR_PENDING" || status === "CONNECTED") { await loadWhatsApp(); return; } } catch (error) { /* ignore transient polling errors */ } await new Promise((resolve) => setTimeout(resolve, 2000)); } await loadWhatsApp(); }
async function connectWhatsApp() { try { $("#connect-wa").disabled = true; await api(`/organizations/${orgId}/whatsapp/connect`, { method: "POST" }); showToast("Connexion WhatsApp initiée"); await waitForWhatsAppStatus(); } catch (error) { showToast(error.message); } finally { $("#connect-wa").disabled = false; } }
async function disconnectWhatsApp() {
  const confirmed = window.confirm("Voulez-vous vraiment déconnecter ce numéro WhatsApp ?");
  if (!confirmed) return;

  try {
    await api(`/organizations/${orgId}/whatsapp/disconnect`, { method: "POST" });
    showToast("Numéro déconnecté");
    loadWhatsApp();
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelectorAll("[data-view], [data-view-target]").forEach((element) => element.onclick = () => setView(element.dataset.view || element.dataset.viewTarget));
$("#agent-form").onsubmit = saveSettings;
$("#agent-test-form").onsubmit = testAgentReply;
$("#clear-agent-test").onclick = clearAgentTest;
$("#save-agent").onclick = () => $("#agent-form").requestSubmit();
$("#delay-form").onsubmit = saveDelaySettings;
$("#save-settings").onclick = () => $("#delay-form").requestSubmit();
$("#location-form").onsubmit = saveLocationConfig;
$("#responsible-form").onsubmit = saveResponsibleConfig;
$("#cancel-responsible-edit").onclick = resetResponsibleForm;
$("#fallback-form").onsubmit = saveFallbackConfig;

const logoutButton = document.createElement("button");
logoutButton.className = "nav-item";
logoutButton.innerHTML = "<span>⇠</span> Se déconnecter";
logoutButton.onclick = () => {
  const confirmed = window.confirm("Voulez-vous vraiment vous déconnecter ?");
  if (confirmed) {
    logoutUser();
  }
};
const sidebarBottom = $(".sidebar-bottom");
sidebarBottom.appendChild(logoutButton);

const newOrgButton = $("#new-org");
if (newOrgButton) {
  newOrgButton.onclick = () => {
    logoutUser("register");
  };
}

$("#commercial-period")?.addEventListener("change", renderCommercialMetrics);
setInterval(updateRealtimeHeader, 1000);

initAuthFlow();
