import { api } from "../../services/api.js";
import { $, escapeHtml } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { onboardingSteps } from "./progress.js";

let navigate = () => {};
let currentOrganization = null;
let expanded = true;
let lastCompletion = false;
let latestStatus = null;
let requestVersion = 0;

function updateBanner(status) {
  const title = $("#overview-agent-status-title"), description = $("#overview-agent-status-description");
  if (!title || !description) return;
  const text = status.suspended ? ["Votre agent est suspendu.", "Consultez le motif dans les réglages ou contactez le support."]
    : !status.aiEnabled ? ["Votre agent est en pause.", "Activez les réponses automatiques dans les réglages de l’agent."]
    : !status.whatsappConnected ? ["Connectez WhatsApp pour démarrer.", "Votre agent pourra répondre dès que votre numéro sera relié."]
    : !status.profileComplete ? ["Complétez les informations de votre entreprise.", "Donnez à votre agent les informations nécessaires avant vos premiers échanges."]
    : ["Votre agent est prêt à échanger.", "Envoyez une première question depuis un autre numéro pour vérifier sa réponse."];
  title.textContent = text[0]; description.textContent = status.firstReplySent && status.aiEnabled && status.whatsappConnected && !status.suspended ? "Votre assistant a déjà répondu automatiquement sur WhatsApp." : text[1];
}

function render(status) {
  const panel = $("#onboarding-guide");
  const steps = onboardingSteps(status);
  const done = steps.filter(step => step.done).length;
  const complete = done === steps.length;
  if (complete && !lastCompletion) expanded = false;
  if (complete) $("#onboarding-first-help").classList.add("hidden");
  lastCompletion = complete;
  const next = steps.find(step => !step.done);
  $("#onboarding-summary").textContent = complete ? "Votre démarrage est terminé" : "Votre assistant, prêt en 4 étapes";
  $("#onboarding-count").textContent = `${done} / ${steps.length} étapes validées`;
  $("#onboarding-progress").classList.remove("hidden");
  $("#onboarding-progress").setAttribute("aria-valuenow", String(done));
  $("#onboarding-progress").setAttribute("aria-valuetext", `${done} étapes sur ${steps.length}`);
  $("#onboarding-progress-fill").style.width = `${done * 25}%`;
  const toggle = $("#onboarding-toggle");
  toggle.textContent = expanded ? "Réduire" : "Voir les étapes";
  toggle.setAttribute("aria-expanded", String(expanded));
  $("#onboarding-body").classList.toggle("hidden", !expanded);
  const primary = $("#onboarding-next");
  primary.classList.toggle("hidden", complete);
  primary.textContent = next?.action || "";
  primary.dataset.onboardingAction = next?.id || "";
  $("#onboarding-steps").innerHTML = steps.map((step, index) => `<li class="onboarding-step${step.done ? " done" : ""}${next?.id === step.id ? " next" : ""}">
    <span class="onboarding-number" aria-hidden="true">${step.done ? "✓" : index + 1}</span>
    <div><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.description)}</p><span class="onboarding-state">${step.done ? "Validée" : next?.id === step.id ? "Prochaine étape" : "À faire"}</span></div>
    <button type="button" class="ghost-button" data-onboarding-action="${step.id}">${step.done ? "Consulter" : escapeHtml(step.action)}</button>
  </li>`).join("");
  $("#onboarding-note").textContent = status.suspended ? "L’agent est suspendu. Consultez le support avant votre essai WhatsApp."
    : !status.aiEnabled ? "Votre agent est en pause. Activez ses réponses automatiques pour recevoir une première réponse."
    : "Les étapes se valident automatiquement à partir de votre configuration et de vos échanges réels.";
  $("#onboarding-error").classList.add("hidden");
  panel.classList.remove("hidden");
  updateBanner(status);
}

export async function refreshOnboarding() {
  const panel = $("#onboarding-guide");
  const organizationId = getState().organizationId;
  if (!panel || !organizationId || document.body.classList.contains("role-agent")) { panel?.classList.add("hidden"); return; }
  if (currentOrganization !== organizationId) {
    currentOrganization = organizationId; latestStatus = null; expanded = true; lastCompletion = false;
    panel.classList.add("hidden");
    $("#onboarding-first-help").classList.add("hidden");
  }
  const version = ++requestVersion;
  try {
    const { onboarding } = await api(`/organizations/${organizationId}/onboarding`);
    if (version !== requestVersion || organizationId !== getState().organizationId) return;
    if (!onboarding || ["profileComplete", "testComplete", "whatsappConnected", "firstReplySent", "aiEnabled", "suspended"].some(key => typeof onboarding[key] !== "boolean")) throw new Error("Progression indisponible.");
    const unchanged = latestStatus && Object.keys(onboarding).every(key => latestStatus[key] === onboarding[key]);
    latestStatus = onboarding;
    if (!unchanged) render(onboarding);
    else { $("#onboarding-error").classList.add("hidden"); panel.classList.remove("hidden"); }
  } catch (error) {
    if (version !== requestVersion || organizationId !== getState().organizationId) return;
    if (error.status === 401 || error.status === 403) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    const errorBox = $("#onboarding-error");
    errorBox.textContent = "Impossible d’actualiser la progression. Vos informations restent enregistrées. Réessayez dans un instant.";
    errorBox.classList.remove("hidden");
    if (!latestStatus) {
      $("#onboarding-body").classList.add("hidden");
      $("#onboarding-count").textContent = "Progression indisponible";
      $("#onboarding-progress").classList.add("hidden");
    }
  }
}

export function initOnboarding(onNavigate) {
  navigate = onNavigate;
  const panel = $("#onboarding-guide");
  panel.addEventListener("click", event => {
    const action = event.target.closest("[data-onboarding-action]")?.dataset.onboardingAction;
    if (action === "first") {
      expanded = true; if (latestStatus) render(latestStatus);
      $("#onboarding-first-help").classList.remove("hidden");
      $("#onboarding-first-help").focus();
    } else if (action) navigate(action);
  });
  $("#onboarding-toggle").onclick = () => { expanded = !expanded; if (latestStatus) render(latestStatus); };
  $("#onboarding-refresh").onclick = refreshOnboarding;
  $("#onboarding-retry").onclick = refreshOnboarding;
  $("#onboarding-open-inbox").onclick = () => navigate("inbox");
  document.addEventListener("brayano:onboarding-changed", () => void refreshOnboarding());
  setInterval(() => {
    if (!document.hidden && $(".app-shell:not(.hidden)") && !$("#overview-view").classList.contains("hidden")) void refreshOnboarding();
  }, 12_000);
}
