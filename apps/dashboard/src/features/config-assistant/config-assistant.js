import { api } from "../../services/api.js";
import { $, $$, escapeHtml, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";

const MAX_PDF_BYTES = 5 * 1024 * 1024;
let activeTab = "text";

function setTab(tab) {
  activeTab = tab;
  $$(".ca-tab").forEach((button) => button.classList.toggle("active", button.dataset.caTab === tab));
  $$(".ca-pane").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.caPane !== tab));
}

function renderResult(analysis) {
  $("#ca-draft").value = analysis.businessInfo || "";

  const missing = $("#ca-missing");
  if (analysis.missing?.length) {
    missing.innerHTML = `<strong>Non trouvé dans votre source — à compléter vous-même :</strong> ${analysis.missing.map((label) => `<span class="ca-chip">${escapeHtml(label)}</span>`).join("")}`;
    missing.classList.remove("hidden");
  } else {
    missing.classList.add("hidden");
  }

  const warnings = $("#ca-warnings");
  if (analysis.warnings?.length) {
    warnings.querySelector("summary").textContent = `${analysis.warnings.length} élément${analysis.warnings.length > 1 ? "s" : ""} écarté${analysis.warnings.length > 1 ? "s" : ""} car non vérifiable${analysis.warnings.length > 1 ? "s" : ""}`;
    warnings.querySelector("ul").innerHTML = analysis.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
    warnings.classList.remove("hidden");
  } else {
    warnings.classList.add("hidden");
  }

  if (!analysis.businessInfo) {
    $("#ca-draft").placeholder = "Aucune information exploitable trouvée dans cette source.";
  }
  $("#ca-result").classList.remove("hidden");
}

async function analyze() {
  const button = $("#ca-analyze");
  const status = $("#ca-status");
  const path = `/organizations/${getState().organizationId}/config-assistant`;
  let request;

  if (activeTab === "text") {
    const text = $("#ca-text").value.trim();
    if (text.length < 20) return showToast("Collez un texte plus long (20 caractères minimum).", "error");
    request = api(`${path}/analyze`, { method: "POST", body: JSON.stringify({ kind: "text", text }) });
  } else if (activeTab === "url") {
    const url = $("#ca-url").value.trim();
    if (!url) return showToast("Indiquez l’adresse de votre site.", "error");
    request = api(`${path}/analyze`, { method: "POST", body: JSON.stringify({ kind: "url", url }) });
  } else {
    const file = $("#ca-pdf").files?.[0];
    if (!file) return showToast("Choisissez un fichier PDF.", "error");
    if (file.type !== "application/pdf" || file.size > MAX_PDF_BYTES) return showToast("Choisissez un PDF de 5 Mo maximum.", "error");
    request = api(`${path}/analyze-pdf`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
  }

  button.disabled = true;
  status.textContent = "Analyse en cours… (jusqu’à 30 secondes)";
  try {
    const { analysis } = await request;
    if (!analysis) throw new Error("Réponse inattendue du serveur.");
    renderResult(analysis);
    status.textContent = "";
  } catch (error) {
    status.textContent = "";
    showToast(error.message || "L’analyse a échoué.", "error");
  } finally {
    button.disabled = false;
  }
}

function applyDraft(mode) {
  const draft = $("#ca-draft").value.trim();
  if (!draft) return showToast("Le brouillon est vide.", "error");
  const target = $("#business-info");
  target.value = mode === "append" && target.value.trim() ? `${target.value.trim()}\n\n${draft}` : draft;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  showToast("Texte placé dans « Informations sur votre activité ». Relisez puis cliquez sur « Enregistrer les modifications ».", "success");
}

export function initConfigAssistant() {
  $$(".ca-tab").forEach((button) => {
    button.onclick = () => setTab(button.dataset.caTab);
  });
  $("#ca-analyze").onclick = analyze;
  $("#ca-apply-replace").onclick = () => applyDraft("replace");
  $("#ca-apply-append").onclick = () => applyDraft("append");
  $("#ca-discard").onclick = () => $("#ca-result").classList.add("hidden");
}
