const API = localStorage.getItem("brayano_api") || "http://localhost:3000";
let orgId = localStorage.getItem("brayano_org");
let conversations = [];
const $ = (selector) => document.querySelector(selector);
const showToast = (message) => { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2800); };

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
  showAuthMode(mode);
}

function showDashboard() {
  $("#login-screen").classList.add("hidden");
  $(".app-shell").classList.remove("hidden");
}

function showAuthMode(mode) {
  const loginForm = $("#login-form");
  const registerForm = $("#register-form");
  const toggleButton = $("#toggle-auth-mode");
  const authTitle = $("#auth-title");
  const authHint = $("#auth-mode-hint");

  if (!loginForm || !registerForm || !toggleButton || !authTitle || !authHint) return;

  const isLogin = mode === "login";
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
  authTitle.textContent = isLogin ? "Connexion à l'espace de pilotage" : "Créer mon espace client";
  authHint.textContent = isLogin ? "Identifiants par défaut : admin@brayano.ai / brayano123" : "Créez votre entreprise et votre compte administrateur.";
  toggleButton.textContent = isLogin ? "Créer un compte" : "Se connecter";
}

function initAuthFlow() {
  const loginForm = $("#login-form");
  const registerForm = $("#register-form");
  const toggleButton = $("#toggle-auth-mode");

  if (!loginForm || !registerForm || !toggleButton) return;

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

      localStorage.setItem("brayano_session", JSON.stringify({ email: result.user.email, token: result.token }));
      localStorage.setItem("brayano_org", result.organizationId);
      showDashboard();
      showToast("Compte créé avec succès.");
      loadOrganizations().catch((error) => showToast(`API inaccessible : ${error.message}`));
    } catch (error) {
      showToast(error.message || "Impossible de créer votre compte.");
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
function setView(view) { document.querySelectorAll(".view").forEach((item) => item.classList.toggle("hidden", item.id !== `${view}-view`)); document.querySelectorAll(".nav-item[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view)); if (view === "inbox") renderInbox(); if (view === "agent") loadSettings(); if (view === "whatsapp") loadWhatsApp(); }
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
  localStorage.setItem("brayano_org", orgId);
  select.value = orgId;
  select.onchange = () => {
    orgId = select.value;
    localStorage.setItem("brayano_org", orgId);
    refresh();
  };
  refresh();
}
async function refresh() { const org = $("#org-select").selectedOptions[0]?.textContent || "Brayano"; $("#current-org").textContent = org; $("#org-initial").textContent = org[0]?.toUpperCase() || "B"; try { const [list, status] = await Promise.all([api(`/organizations/${orgId}/conversations`), api(`/organizations/${orgId}/whatsapp/status`)]); conversations = list.conversations || []; $("#metric-active").textContent = conversations.filter((item) => item.status === "OPEN").length; $("#metric-messages").textContent = conversations.reduce((count, item) => count + (item.messages?.length || 0), 0); updateWhatsAppMetric(status.status); renderRecent(); $("#nav-count").textContent = conversations.filter((item) => item.status === "OPEN").length; } catch (error) { showToast(error.message); } }
function updateWhatsAppMetric(status) { const connected = status === "CONNECTED"; $("#metric-whatsapp").textContent = connected ? "Connecté" : "Déconnecté"; $("#metric-whatsapp").style.color = connected ? "var(--green)" : "var(--orange)"; $("#metric-phone").textContent = connected ? "Numéro opérationnel" : "Connexion requise"; }
function conversationMarkup(item) { const name = item.contact?.displayName || item.contact?.whatsappJid || "Contact"; const last = item.messages?.[item.messages.length - 1]; return `<div class="conversation-row" data-id="${item.id}"><span class="contact-avatar">${initials(name)}</span><div class="conversation-main"><strong>${name}</strong><p>${last?.content || "Aucun message"}</p></div><div class="conversation-meta">${last ? formatTime(last.createdAt) : ""}${item.status === "OPEN" ? '<span class="unread">Actif</span>' : ""}</div></div>`; }
function renderRecent() { const target = $("#recent-conversations"); target.innerHTML = conversations.length ? conversations.slice(0, 4).map(conversationMarkup).join("") : '<div class="empty-state">Aucune conversation pour le moment.</div>'; target.querySelectorAll(".conversation-row").forEach((row) => row.onclick = () => openConversation(row.dataset.id)); }
function renderInbox() { $("#inbox-total").textContent = `${conversations.length} conversation${conversations.length > 1 ? "s" : ""}`; const target = $("#all-conversations"); target.innerHTML = conversations.length ? conversations.map(conversationMarkup).join("") : '<div class="empty-state">Aucune conversation pour le moment.</div>'; target.querySelectorAll(".conversation-row").forEach((row) => row.onclick = () => openConversation(row.dataset.id)); }
async function openConversation(id) { try { const data = await api(`/organizations/${orgId}/conversations/${id}`); const conversation = data.conversation; const name = conversation.contact?.displayName || conversation.contact?.whatsappJid || "Contact"; $("#conversation-detail").innerHTML = `<div class="panel-heading"><div><h2>${name}</h2><p class="muted">${conversation.aiEnabled ? "Agent IA actif" : "Prise en main humaine"}</p></div><button class="ghost-button" id="toggle-ai">${conversation.aiEnabled ? "Désactiver l'IA" : "Réactiver l'IA"}</button></div><div class="messages">${(conversation.messages || []).map((message) => `<div style="padding:10px 13px;margin:8px 0;max-width:75%;border-radius:10px;background:${message.author === "CONTACT" ? "#f3f4f8" : "#f0edff"};margin-left:${message.author === "CONTACT" ? "0" : "auto"};font-size:12px">${message.content}</div>`).join("")}</div><form id="reply-form" style="display:flex;gap:8px;margin-top:22px"><input required placeholder="Écrire une réponse..." style="flex:1;border:1px solid var(--line);border-radius:8px;padding:11px" /><button class="primary">Envoyer</button></form>`; $("#toggle-ai").onclick = () => toggleAi(id, conversation.aiEnabled); $("#reply-form").onsubmit = (event) => reply(event, id); } catch (error) { showToast(error.message); } }
async function reply(event, id) { event.preventDefault(); const input = event.target.querySelector("input"); try { await api(`/organizations/${orgId}/conversations/${id}/reply`, { method: "POST", body: JSON.stringify({ text: input.value }) }); input.value = ""; showToast("Réponse envoyée"); await refresh(); await openConversation(id); } catch (error) { showToast(error.message); } }
async function toggleAi(id, enabled) { try { await api(`/organizations/${orgId}/conversations/${id}/ai/${enabled ? "disable" : "enable"}`, { method: "POST" }); showToast(enabled ? "IA désactivée" : "IA réactivée"); await refresh(); await openConversation(id); } catch (error) { showToast(error.message); } }
async function loadSettings() { try { const { settings } = await api(`/organizations/${orgId}/ai-settings`); $("#agent-name").value = settings.agentName || ""; $("#business-info").value = settings.businessInfo || ""; $("#system-prompt").value = settings.systemPrompt || ""; $("#welcome-message").value = settings.welcomeMessage || ""; } catch (error) { showToast(error.message); } }
async function saveSettings(event) { event.preventDefault(); try { await api(`/organizations/${orgId}/ai-settings`, { method: "PUT", body: JSON.stringify({ agentName: $("#agent-name").value, businessInfo: $("#business-info").value, systemPrompt: $("#system-prompt").value, welcomeMessage: $("#welcome-message").value }) }); showToast("Configuration enregistrée"); } catch (error) { showToast(error.message); } }
async function loadWhatsApp() { try { const { status } = await api(`/organizations/${orgId}/whatsapp/status`); const connected = status === "CONNECTED"; $("#wa-title").textContent = connected ? "WhatsApp connecté" : status === "QR_PENDING" ? "Scannez le QR code" : "WhatsApp déconnecté"; $("#qr-status").textContent = connected ? "Connecté" : status === "QR_PENDING" ? "QR disponible" : "En attente"; $("#qr-status").className = `pill ${connected ? "" : "warning"}`; $("#disconnect-wa").classList.toggle("hidden", !connected); if (status === "QR_PENDING") { const result = await api(`/organizations/${orgId}/whatsapp/qr`); $("#qr-container").innerHTML = `<img src="${result.qr}" alt="QR code WhatsApp" style="width:230px;height:230px" />`; } else if (!connected) { $("#qr-container").innerHTML = ""; } } catch (error) { showToast(error.message); } }
async function waitForWhatsAppStatus() { const deadline = Date.now() + 30000; while (Date.now() < deadline) { try { const { status } = await api(`/organizations/${orgId}/whatsapp/status`); if (status === "QR_PENDING" || status === "CONNECTED") { await loadWhatsApp(); return; } } catch (error) { /* ignore transient polling errors */ } await new Promise((resolve) => setTimeout(resolve, 2000)); } await loadWhatsApp(); }
async function connectWhatsApp() { try { $("#connect-wa").disabled = true; await api(`/organizations/${orgId}/whatsapp/connect`, { method: "POST" }); showToast("Connexion WhatsApp initiée"); await waitForWhatsAppStatus(); } catch (error) { showToast(error.message); } finally { $("#connect-wa").disabled = false; } }
async function disconnectWhatsApp() { try { await api(`/organizations/${orgId}/whatsapp/disconnect`, { method: "POST" }); showToast("Numéro déconnecté"); loadWhatsApp(); } catch (error) { showToast(error.message); } }
document.querySelectorAll("[data-view], [data-view-target]").forEach((element) => element.onclick = () => setView(element.dataset.view || element.dataset.viewTarget));
$("#agent-form").onsubmit = saveSettings; $("#save-agent").onclick = () => $("#agent-form").requestSubmit();

const logoutButton = document.createElement("button");
logoutButton.className = "nav-item";
logoutButton.innerHTML = "<span>⇠</span> Se déconnecter";
logoutButton.onclick = logoutUser;
const sidebarBottom = $(".sidebar-bottom");
sidebarBottom.appendChild(logoutButton);

const newOrgButton = $("#new-org");
if (newOrgButton) {
  newOrgButton.onclick = () => {
    logoutUser("register");
  };
}

initAuthFlow();
