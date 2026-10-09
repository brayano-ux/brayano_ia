import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { getState, setState } from "../../state/store.js";
import { APP_CONFIG } from "../../config.js";
import { applyPlatformSuspension } from "../suspension/suspension.js";

/**
 * Feature "Agent IA" : configuration de la base de connaissances
 * (prompt, champs de qualification) + testeur en direct (playground).
 */

function renderCustomQualificationFields(fields = []) {
  const container = $("#custom-qualification-fields");
  container.innerHTML = fields
    .filter((field) => !APP_CONFIG.standardQualificationFields.includes(field))
    .map((field) => {
      const label = field.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
      return `<label><input type="checkbox" class="custom-qualification-field" value="${escapeHtml(field)}" checked /> ${escapeHtml(label)}</label>`;
    })
    .join("");
}

function renderAgentImagePreview(url) {
  const preview = $("#agent-image-preview");
  if (!url) {
    preview.classList.add("hidden");
    preview.removeAttribute("src");
    return;
  }

  preview.src = url;
  preview.classList.remove("hidden");
}

export async function loadSettings() {
  try {
    const { settings, platformSuspension } = await api(`/organizations/${getState().organizationId}/ai-settings`);
    const qualificationFields = settings.qualificationFields || [];

    $("#global-ai-enabled").checked = settings.aiEnabled !== false;
    applyPlatformSuspension(platformSuspension);
    $("#agent-name").value = settings.agentName || "";
    $("#business-info").value = settings.businessInfo || "";
    $("#agent-image-url").value = settings.agentImageUrl || "";
    renderAgentImagePreview(settings.agentImageUrl || "");
    $("#system-prompt").value = settings.systemPrompt || "";
    $("#welcome-message").value = settings.welcomeMessage || "";

    $$('input[name="qualification-field"]').forEach((input) => {
      input.checked = qualificationFields.includes(input.value);
    });
    renderCustomQualificationFields(qualificationFields);
    markClean();
    refreshAgentChrome();
    loadFeatureStates();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleAgentImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("Veuillez choisir un fichier image valide.", "error");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === "string" ? reader.result : "";
    $("#agent-image-url").value = result;
    renderAgentImagePreview(result);
    refreshAgentChrome();
    showToast("Image de l'agent importée avec succès.", "success");
  };
  reader.onerror = () => {
    showToast("Impossible de lire cette image.", "error");
  };
  reader.readAsDataURL(file);
}

async function saveSettings(event) {
  event.preventDefault();
  if (!$("#agent-name").value.trim()) return focusInvalid("identity", "#agent-name", "Donnez un nom à votre agent.");
  if (!$("#system-prompt").value.trim()) return focusInvalid("behavior", "#system-prompt", "Les instructions de l'agent sont obligatoires.");
  const saveButton = $("#save-agent");
  saveButton.disabled = true;
  try {
    const standardFields = $$('input[name="qualification-field"]:checked').map((input) => input.value);
    const customFields = $$(".custom-qualification-field:checked").map((input) => input.value);
    const qualificationFields = [...new Set([...standardFields, ...customFields])];
    const aiEnabled = $("#global-ai-enabled").checked;

    await api(`/organizations/${getState().organizationId}/ai-settings`, {
      method: "PUT",
      body: JSON.stringify({
        aiEnabled,
        agentName: $("#agent-name").value,
        businessInfo: $("#business-info").value,
        agentImageUrl: $("#agent-image-url").value,
        systemPrompt: $("#system-prompt").value,
        welcomeMessage: $("#welcome-message").value,
        qualificationFields,
      }),
    });
    markClean();
    refreshAgentChrome();
    showToast(aiEnabled ? "Modifications enregistrées — agent actif" : "Modifications enregistrées — agent en pause", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    saveButton.disabled = false;
  }
}

function createQualificationField() {
  const input = $("#custom-qualification-field-input");
  const field = input.value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!field) return;

  const existingFields = $$('input[name="qualification-field"], .custom-qualification-field').map((item) => item.value);
  if (existingFields.includes(field)) {
    showToast("Ce champ existe déjà.", "error");
    return;
  }

  renderCustomQualificationFields([...$$(".custom-qualification-field")].map((item) => item.value).concat(field));
  input.value = "";
  refreshAgentChrome();
  showToast("Champ ajouté et coché.", "success");
}

function renderAgentTestHistory() {
  const container = $("#agent-test-messages");
  const { agentTestHistory } = getState();

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
  setState({ agentTestHistory: [] });
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
  const history = [...getState().agentTestHistory, { role: "user", content: message }];
  setState({ agentTestHistory: history });
  renderAgentTestHistory();
  input.value = "";

  try {
    const result = await api(`/organizations/${getState().organizationId}/ai-test/reply`, {
      method: "POST",
      body: JSON.stringify({ message, history: history.slice(0, -1) }),
    });
    setState({ agentTestHistory: [...history, { role: "assistant", content: result.reply }] });
    renderAgentTestHistory();

    const resultPanel = $("#agent-test-result");
    resultPanel.classList.remove("hidden");
    const selectedProduct = result.productName ? ` | Produit retenu : ${result.productName}` : "";
    resultPanel.textContent = `Qualification : ${result.qualificationStatus} | Score : ${result.leadScore}/100 | Action : ${result.nextAction}${selectedProduct}`;
  } catch (error) {
    setState({ agentTestHistory: history.slice(0, -1) });
    renderAgentTestHistory();
    showToast(error.message || "Impossible de tester l'agent.", "error");
  } finally {
    button.disabled = false;
    input.disabled = false;
    input.focus();
  }
}


/* ------------------------------------------------------------------
   Refonte de la page : onglets, état, complétude, modèles, fonctions
------------------------------------------------------------------- */

const TEMPLATES = {
  boutique: "Tu es l'assistant d'une boutique. Accueille chaque client chaleureusement, comprends ce qu'il cherche et recommande uniquement les produits du catalogue. Donne les prix exacts du catalogue. Si le client veut acheter, recueille le produit, la quantité, son nom et son adresse de livraison. Si une information manque, dis-le honnêtement et propose de passer la main à l'équipe. Réponds de façon courte, polie et claire.",
  salon: "Tu es l'assistante d'un salon de coiffure et de beauté. Présente les prestations et les tarifs indiqués dans les informations de l'entreprise. Aide le client à choisir un créneau parmi les horaires disponibles et confirme-le clairement. N'invente jamais un tarif, une durée ou une disponibilité. Reste chaleureuse, polie et concise.",
  clinique: "Tu es l'assistant d'accueil d'une clinique. Donne uniquement les informations pratiques (horaires, adresse, services listés) et aide à prendre rendez-vous. Ne donne jamais de conseil ni de diagnostic médical : en cas d'urgence ou de question de santé, invite le patient à appeler la clinique ou les urgences. Reste respectueux et discret.",
  restaurant: "Tu es l'assistant d'un restaurant / traiteur. Présente le menu, les prix et les horaires indiqués dans les informations de l'entreprise. Prends les réservations ou les commandes en demandant les informations nécessaires (nom, nombre de personnes ou plats, adresse si livraison). N'invente aucun plat ni aucun prix. Réponds simplement et aimablement.",
  services: "Tu es l'assistant d'une entreprise de services. Comprends le besoin du client, explique les services proposés d'après les informations de l'entreprise, puis recueille son nom, sa ville et son besoin pour que l'équipe le recontacte. N'annonce jamais un prix ou un délai qui n'est pas indiqué. Reste professionnel, clair et courtois.",
};

let cleanSnapshot = "";

function snapshot() {
  return JSON.stringify([
    $("#agent-name").value, $("#business-info").value, $("#agent-image-url").value, $("#system-prompt").value,
    $("#welcome-message").value, $("#global-ai-enabled").checked,
    $$('input[name="qualification-field"]:checked, .custom-qualification-field:checked').map((input) => input.value).sort(),
  ]);
}

function markClean() {
  cleanSnapshot = snapshot();
  $("#agent-dirty").classList.add("hidden");
}

function setActiveTab(tab) {
  $$(".agent-tab").forEach((button) => {
    const active = button.dataset.agentTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$(".agent-pane").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.agentPane !== tab));
}

function focusInvalid(tab, selector, message) {
  setActiveTab(tab);
  showToast(message, "error");
  $(selector).focus();
}

function initials(name) {
  const letters = String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
  return letters || "IA";
}

function refreshAgentChrome() {
  const name = $("#agent-name").value.trim();
  const toggle = $("#global-ai-enabled");
  const imageUrl = $("#agent-image-url").value.trim();

  $("#agent-hero-name").textContent = name || "Assistant";
  const avatar = $("#agent-avatar");
  if (imageUrl) {
    avatar.textContent = "";
    avatar.style.backgroundImage = `url("${imageUrl.replace(/"/g, "%22")}")`;
    avatar.classList.add("has-image");
  } else {
    avatar.style.backgroundImage = "";
    avatar.classList.remove("has-image");
    avatar.textContent = initials(name);
  }

  const pill = $("#agent-hero-status");
  const suspended = toggle.disabled;
  pill.className = `agent-status-pill ${suspended ? "off" : toggle.checked ? "on" : "paused"}`;
  pill.textContent = suspended ? "Suspendu" : toggle.checked ? "Actif" : "En pause";

  $$("[data-counter-for]").forEach((counter) => {
    const field = $(`#${counter.dataset.counterFor}`);
    counter.textContent = `${field.value.length} / ${field.maxLength} caractères`;
  });

  renderCompleteness();
  const dirty = snapshot() !== cleanSnapshot;
  $("#agent-dirty").classList.toggle("hidden", !dirty);
}

function renderCompleteness() {
  const name = $("#agent-name").value.trim();
  const checks = [
    { done: Boolean(name) && name.toLowerCase() !== "assistant", label: "Donnez un nom à votre agent", tab: "identity" },
    { done: $("#business-info").value.trim().length >= 150, label: "Décrivez votre entreprise (horaires, adresse, tarifs…)", tab: "knowledge" },
    { done: $("#system-prompt").value.trim().length >= 60, label: "Précisez les instructions de l'agent", tab: "behavior" },
    { done: $("#welcome-message").value.trim().length > 0, label: "Écrivez un message d'accueil", tab: "behavior" },
    { done: $$('input[name="qualification-field"]:checked, .custom-qualification-field:checked').length > 0, label: "Choisissez les informations à collecter", tab: "behavior" },
  ];
  const done = checks.filter((check) => check.done).length;
  const percent = Math.round((done / checks.length) * 100);
  $("#agent-score-label").textContent = `${done} / ${checks.length}`;
  $("#agent-meter").setAttribute("aria-valuenow", String(percent));
  $("#agent-meter-fill").style.width = `${percent}%`;
  const list = $("#agent-checklist");
  list.innerHTML = checks
    .map((check, index) => `<li class="${check.done ? "done" : ""}"><button type="button" data-check-tab="${check.tab}" data-check-index="${index}">${check.done ? "✓" : "○"} ${escapeHtml(check.label)}</button></li>`)
    .join("");
  $$("[data-check-tab]", list).forEach((button) => {
    button.onclick = () => setActiveTab(button.dataset.checkTab);
  });
}

async function loadFeatureStates() {
  const base = `/organizations/${getState().organizationId}`;
  const setState_ = (id, text, on) => {
    const element = $(id);
    if (!element) return;
    element.textContent = text;
    element.className = `agent-feature-state ${on === null ? "" : on ? "on" : "off"}`.trim();
  };
  const [products, appointments, orders] = await Promise.allSettled([
    api(`${base}/products`),
    api(`${base}/appointments/settings`),
    api(`${base}/orders/settings`),
  ]);
  if (products.status === "fulfilled") {
    const active = products.value.products.filter((product) => product.active).length;
    setState_("#feature-products-state", active ? `${active} produit${active > 1 ? "s" : ""}` : "Aucun produit", active > 0);
  } else setState_("#feature-products-state", "—", null);
  if (appointments.status === "fulfilled") setState_("#feature-appointments-state", appointments.value.settings.enabled ? "Activé" : "Désactivé", appointments.value.settings.enabled);
  else setState_("#feature-appointments-state", "—", null);
  if (orders.status === "fulfilled") setState_("#feature-orders-state", orders.value.settings.enabled ? "Activé" : "Désactivé", orders.value.settings.enabled);
  else setState_("#feature-orders-state", "—", null);
}

function applyTemplate() {
  const select = $("#agent-template");
  const key = select.value;
  select.value = "";
  if (!key || !TEMPLATES[key]) return;
  const field = $("#system-prompt");
  if (field.value.trim() && !window.confirm("Remplacer les instructions actuelles par ce modèle ?")) return;
  field.value = TEMPLATES[key];
  field.dispatchEvent(new Event("input", { bubbles: true }));
  showToast("Modèle appliqué. Adaptez-le puis enregistrez.", "success");
}

function initAgentChrome() {
  $("#agent-form").noValidate = true;
  $$(".agent-tab").forEach((button) => {
    button.onclick = () => setActiveTab(button.dataset.agentTab);
  });
  $$("[data-goto-view]").forEach((button) => {
    button.onclick = () => $(`.nav-item[data-view="${button.dataset.gotoView}"]`)?.click();
  });
  ["input", "change"].forEach((type) => $("#agent-view").addEventListener(type, (event) => {
    if (event.target.closest("#agent-form") || event.target.id === "global-ai-enabled") refreshAgentChrome();
  }));
  $("#agent-template").onchange = applyTemplate;

  // Entrée dans le champ « site web » de l'assistant ne doit jamais enregistrer le formulaire.
  $("#ca-url").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("#ca-analyze").click();
    }
  });

  $$(".agent-suggestion").forEach((button) => {
    button.onclick = () => {
      $("#agent-test-input").value = button.textContent;
      $("#agent-test-form").requestSubmit();
    };
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && !$("#agent-view").classList.contains("hidden")) {
      event.preventDefault();
      $("#agent-form").requestSubmit();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (cleanSnapshot && snapshot() !== cleanSnapshot) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

export function initAgent() {
  initAgentChrome();
  $("#agent-form").onsubmit = saveSettings;
  $("#save-agent").onclick = () => $("#agent-form").requestSubmit();
  $("#agent-image-file").onchange = handleAgentImageUpload;
  $("#agent-image-url").oninput = () => renderAgentImagePreview($("#agent-image-url").value);
  $("#create-qualification-field").onclick = createQualificationField;
  $("#custom-qualification-field-input").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createQualificationField();
    }
  };
  $("#agent-test-form").onsubmit = testAgentReply;
  $("#clear-agent-test").onclick = clearAgentTest;
}
