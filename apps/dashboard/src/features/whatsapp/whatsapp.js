import { api } from "../../services/api.js";
import { $, showToast } from "../../utils/dom.js";
import { getState } from "../../state/store.js";

/**
 * Feature "Connexion WhatsApp" : statut du numéro, QR code de liaison,
 * connexion / déconnexion, avec un polling léger pendant le scan.
 */
export async function loadWhatsApp() {
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

    if (status === "QR_PENDING") {
      if (pairingCode) {
        $("#qr-container").className = "qr-placeholder pairing-code-placeholder";
        $("#qr-container").innerHTML = '<div><p>Sur votre téléphone, choisissez « Lier avec un numéro de téléphone » puis saisissez :</p><strong id="pairing-code-value"></strong></div>';
        $("#pairing-code-value").textContent = pairingCode;
      } else {
        const result = await api(`/organizations/${orgId}/whatsapp/qr`);
        $("#qr-container").className = "qr-placeholder";
        $("#qr-container").innerHTML = `<img src="${result.qr}" alt="QR code WhatsApp" />`;
      }
    } else if (!connected) {
      $("#qr-container").className = "qr-placeholder";
      $("#qr-container").innerHTML = '<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3"/><path d="M21 14v.01"/><path d="M14 21h.01"/><path d="M18 18h3v3h-3z"/></svg></span><p>Le QR code apparaîtra ici</p>';
    }
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function waitForWhatsAppStatus() {
  const orgId = getState().organizationId;
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    try {
      const { status } = await api(`/organizations/${orgId}/whatsapp/status`);
      if (status === "QR_PENDING" || status === "CONNECTED") {
        await loadWhatsApp();
        return;
      }
    } catch {
      // Erreurs transitoires de polling ignorées volontairement.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await loadWhatsApp();
}

async function connectWhatsApp() {
  const button = $("#connect-wa");
  try {
    button.disabled = true;
    await api(`/organizations/${getState().organizationId}/whatsapp/connect`, { method: "POST" });
    showToast("Connexion WhatsApp initiée", "info");
    await waitForWhatsAppStatus();
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
