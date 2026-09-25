import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { getState, setState } from "../../state/store.js";
import { APP_CONFIG } from "../../config.js";

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

export async function loadSettings() {
  try {
    const { settings } = await api(`/organizations/${getState().organizationId}/ai-settings`);
    const qualificationFields = settings.qualificationFields || [];

    $("#global-ai-enabled").checked = settings.aiEnabled !== false;
    $("#agent-name").value = settings.agentName || "";
    $("#business-info").value = settings.businessInfo || "";
    $("#system-prompt").value = settings.systemPrompt || "";
    $("#welcome-message").value = settings.welcomeMessage || "";

    $$('input[name="qualification-field"]').forEach((input) => {
      input.checked = qualificationFields.includes(input.value);
    });
    renderCustomQualificationFields(qualificationFields);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function saveSettings(event) {
  event.preventDefault();
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
        systemPrompt: $("#system-prompt").value,
        welcomeMessage: $("#welcome-message").value,
        qualificationFields,
      }),
    });
    showToast(aiEnabled ? "Agent IA activé" : "Agent IA désactivé", "success");
  } catch (error) {
    showToast(error.message, "error");
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
    resultPanel.textContent = `Qualification : ${result.qualificationStatus} | Score : ${result.leadScore}/100 | Action : ${result.nextAction}`;
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

export function initAgent() {
  $("#agent-form").onsubmit = saveSettings;
  $("#save-agent").onclick = () => $("#agent-form").requestSubmit();
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
