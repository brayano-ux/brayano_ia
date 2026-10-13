import { api } from "../../services/api.js";
import { $, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";

/**
 * Feature "Connexion WhatsApp" : statut du numéro, QR code de liaison,
 * connexion / déconnexion, avec un polling léger pendant le scan.
 */
const POLL_INTERVAL_MS = 3000;
const WAIT_AFTER_CONNECT_MS = 90000;

let pollTimer = null;
let waitingUntil = 0;
let renderedQr = null;

const DEFAULT_DESCRIPTION = "Connectez WhatsApp en scannant le QR code ou en recevant un code d'association.";
const QR_PLACEHOLDER = '<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3"/><path d="M21 14v.01"/><path d="M14 21h.01"/><path d="M18 18h3v3h-3z"/></svg></span><p>Le QR code apparaîtra ici</p>';
const CONNECTED_PLACEHOLDER = '<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 9.5"/></svg></span><p>Votre numéro est connecté : l\'assistant répond à vos clients.</p>';

function whatsappViewVisible() {
  const view = $("#whatsapp-view");
  return Boolean(view) && !view.classList.contains("hidden");
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll() {
  stopPolling();
  pollTimer = setTimeout(() => {
    if (!whatsappViewVisible()) return; // l'utilisateur a changé de page : on s'arrête
    loadWhatsApp({ silent: true });
  }, POLL_INTERVAL_MS);
}

/**
 * Affiche l'état du numéro. Tant que le numéro n'est pas connecté et qu'une connexion est
 * en cours (QR affiché, ou connexion demandée il y a moins de 90 s), la page se met à jour
 * toute seule : nouveau QR code dès qu'il change, puis « WhatsApp connecté » après le scan.
 */
export async function loadWhatsApp({ silent = false } = {}) {
  try {
    const orgId = getState().organizationId;
    const { status } = await api(`/organizations/${orgId}/whatsapp/status`);
    const connected = status === "CONNECTED";
    let pairingCode = null;

    if (status === "QR_PENDING") {
      try {
        ({ code: pairingCode } = await api(`/organizations/${orgId}/whatsapp/pairing-code`));
      } catch {
        pairingCode = null;
      }
    }

    $("#wa-title").textContent = connected ? "WhatsApp connecté" : pairingCode ? "Saisissez le code dans WhatsApp" : status === "QR_PENDING" ? "Scannez le QR code" : "WhatsApp déconnecté";
    $("#wa-description").textContent = connected ? "Votre numéro WhatsApp est relié : l'assistant répond aux messages de vos clients." : DEFAULT_DESCRIPTION;
    $("#qr-status").textContent = connected ? "Connecté" : pairingCode ? "Code prêt" : status === "QR_PENDING" ? "QR disponible" : "En attente";
    $("#qr-status").className = `pill ${connected ? "" : "warning"}`;
    $("#disconnect-wa").classList.toggle("hidden", !connected);
    $("#connect-wa").classList.toggle("hidden", connected);
    $("#show-pairing-form").classList.toggle("hidden", connected);
    if (connected) {
      $("#pairing-code-form").classList.add("hidden");
      $("#show-pairing-form").setAttribute("aria-expanded", "false");
      $("#show-pairing-form").textContent = "Utiliser un code d'association";
    }

    if (connected) {
      renderedQr = null;
      $("#qr-container").className = "qr-placeholder";
      $("#qr-container").innerHTML = CONNECTED_PLACEHOLDER;
    } else if (status === "QR_PENDING") {
      if (pairingCode) {
        renderedQr = null;
        const current = $("#pairing-code-value");
        if (!current || current.textContent !== pairingCode) {
          $("#qr-container").className = "qr-placeholder pairing-code-placeholder";
          $("#qr-container").innerHTML = '<div><p>Sur votre téléphone, choisissez « Lier avec un numéro de téléphone » puis saisissez :</p><strong id="pairing-code-value"></strong></div>';
          $("#pairing-code-value").textContent = pairingCode;
        }
      } else {
        const result = await api(`/organizations/${orgId}/whatsapp/qr`);
        // On ne remplace l'image que si le QR a changé (évite le clignotement toutes les 3 s).
        if (result.qr !== renderedQr || !$("#qr-container img")) {
          renderedQr = result.qr;
          $("#qr-container").className = "qr-placeholder";
          $("#qr-container").innerHTML = "";
          const image = document.createElement("img");
          image.src = result.qr;
          image.alt = "QR code WhatsApp";
          $("#qr-container").appendChild(image);
        }
      }
    } else {
      renderedQr = null;
      $("#qr-container").className = "qr-placeholder";
      $("#qr-container").innerHTML = QR_PLACEHOLDER;
    }

    const waiting = status === "QR_PENDING" || Date.now() < waitingUntil;
    if (!connected && waiting && whatsappViewVisible()) schedulePoll();
    else stopPolling();
  } catch (error) {
    if (!silent) showToast(error.message, "error");
    // Erreur réseau passagère pendant une connexion : on réessaie.
    if (silent && Date.now() < waitingUntil && whatsappViewVisible()) schedulePoll();
  }
}

async function connectWhatsApp() {
  const button = $("#connect-wa");
  try {
    button.disabled = true;
    await api(`/organizations/${getState().organizationId}/whatsapp/connect`, { method: "POST" });
    showToast("Connexion WhatsApp initiée : le QR code va apparaître.", "info");
    waitingUntil = Date.now() + WAIT_AFTER_CONNECT_MS;
    await loadWhatsApp();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function connectWhatsAppWithCode(event) {
  event.preventDefault();
  const button = $("#connect-with-code");
  const phoneNumber = $("#pairing-phone").value.trim();
  try {
    button.disabled = true;
    $("#connect-wa").disabled = true;
    await api(`/organizations/${getState().organizationId}/whatsapp/connect-with-code`, {
      method: "POST",
      body: JSON.stringify({ phoneNumber }),
    });
    showToast("Code d'association généré", "success");
    waitingUntil = Date.now() + WAIT_AFTER_CONNECT_MS;
    await loadWhatsApp();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    $("#connect-wa").disabled = false;
  }
}

async function disconnectWhatsApp() {
  const confirmed = window.confirm("Voulez-vous vraiment déconnecter ce numéro WhatsApp ?");
  if (!confirmed) return;

  try {
    await api(`/organizations/${getState().organizationId}/whatsapp/disconnect`, { method: "POST" });
    showToast("Numéro déconnecté", "success");
    waitingUntil = 0;
    await loadWhatsApp();
  } catch (error) {
    showToast(error.message, "error");
  }
}

export function initWhatsapp() {
  $("#connect-wa").onclick = connectWhatsApp;
  $("#show-pairing-form").onclick = () => {
    const form = $("#pairing-code-form");
    const button = $("#show-pairing-form");
    const isOpening = form.classList.contains("hidden");
    form.classList.toggle("hidden", !isOpening);
    button.setAttribute("aria-expanded", String(isOpening));
    button.textContent = isOpening ? "Masquer la saisie du numéro" : "Utiliser un code d'association";
    if (isOpening) $("#pairing-phone").focus();
  };
  $("#pairing-code-form").onsubmit = connectWhatsAppWithCode;
  $("#disconnect-wa").onclick = disconnectWhatsApp;
}
