import { api } from "../../services/api.js";
import { $, escapeHtml } from "../../utils/dom.js";
import { getState } from "../../state/store.js";
import { onboardingSteps } from "./progress.js";
import { icon } from "../../ui/icons.js";

let navigate = () => {};
let currentOrganization = null;
/** Sur téléphone le guide démarre replié : seule la prochaine étape est affichée, pour ne pas repousser tout le reste. */
const startsExpanded = () => !window.matchMedia("(max-width: 767px)").matches;
let expanded = startsExpanded();
let lastCompletion = false;
/** Le guide a été affiché avec une étape restante depuis l'ouverture : s'il se termine, on le montre terminé. */
let sawIncomplete = false;
let latestStatus = null;
let requestVersion = 0;

const isComplete = (status) => onboardingSteps(status).every((step) => step.done);

/**
 * Un démarrage déjà terminé à l'ouverture n'a plus rien à dire : le guide laisse la place à « À traiter ».
 * Il revient de lui-même si une étape se défait (WhatsApp déconnecté, par exemple).
 */
const guideHidden = (status) => isComplete(status) && !sawIncomplete;

/** Seul rappel permanent : l'agent est en pause (une suspension a son propre bandeau, sur toutes les pages). */
function updateBanner(status) {
  $(".status-banner")?.classList.toggle("hidden", status.aiEnabled || status.suspended);
}

function render(status) {
  const panel = $("#onboarding-guide");
  const steps = onboardingSteps(status);
  const done = steps.filter(step => step.done).length;
  const complete = done === steps.length;
  if (!complete) sawIncomplete = true;
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
  toggle.textContent = expanded ? "Réduire" : complete ? "Voir les étapes" : "Voir les 4 étapes";
  toggle.setAttribute("aria-expanded", String(expanded));
  // Replié et pas terminé : on garde la prochaine étape visible, c'est la seule chose à faire maintenant.
  $("#onboarding-body").classList.toggle("hidden", !expanded && complete);
  $("#onboarding-body").classList.toggle("only-next", !expanded && !complete);
  $("#onboarding-steps").innerHTML = steps.map((step, index) => {
    const isNext = next?.id === step.id;
    const state = step.done ? '<span class="badge success onboarding-state">Validée</span>' : isNext ? '<span class="badge info onboarding-state">Prochaine étape</span>' : '<span class="badge neutral onboarding-state">À faire</span>';
    return `<li class="onboarding-step${step.done ? " done" : ""}${isNext ? " next" : ""}">
    <span class="onboarding-number" aria-hidden="true">${step.done ? icon("check") : index + 1}</span>
    <div class="onboarding-step-text"><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.description)}</p></div>
    ${state}
    <button type="button" class="btn btn-sm ${isNext ? "btn-primary" : "btn-secondary"}" data-onboarding-action="${step.id}">${step.done ? "Consulter" : escapeHtml(step.action)}</button>
  </li>`;
  }).join("");
  $("#onboarding-note").textContent = status.suspended ? "L’agent est suspendu. Consultez le support avant votre essai WhatsApp."
    : !status.aiEnabled ? "Votre agent est en pause. Activez ses réponses automatiques pour recevoir une première réponse."
    : "Les étapes se valident automatiquement à partir de votre configuration et de vos échanges réels.";
  $("#onboarding-error").classList.add("hidden");
  panel.classList.toggle("hidden", guideHidden(status));
  updateBanner(status);
}

export async function refreshOnboarding() {
  const panel = $("#onboarding-guide");
  const organizationId = getState().organizationId;
  // Un employé ne règle pas l'agent : ni guide, ni rappel de pause (y compris après un changement de compte).
  if (!panel || !organizationId || document.body.classList.contains("role-agent")) { panel?.classList.add("hidden"); $(".status-banner")?.classList.add("hidden"); return; }
  if (currentOrganization !== organizationId) {
    currentOrganization = organizationId; latestStatus = null; expanded = startsExpanded(); lastCompletion = false; sawIncomplete = false;
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
    else { $("#onboarding-error").classList.add("hidden"); panel.classList.toggle("hidden", guideHidden(onboarding)); }
  } catch (error) {
    if (version !== requestVersion || organizationId !== getState().organizationId) return;
    if (error.status === 401 || error.status === 403) { panel.classList.add("hidden"); return; }
    // Guide déjà masqué (démarrage terminé) : une actualisation ratée ne le fait pas réapparaître avec une erreur.
    if (latestStatus && guideHidden(latestStatus)) return;
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
