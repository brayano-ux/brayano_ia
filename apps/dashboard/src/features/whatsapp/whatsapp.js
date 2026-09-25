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

    $("#wa-title").textContent = connected ? "WhatsApp connecté" : status === "QR_PENDING" ? "Scannez le QR code" : "WhatsApp déconnecté";
    $("#qr-status").textContent = connected ? "Connecté" : status === "QR_PENDING" ? "QR disponible" : "En attente";
    $("#qr-status").className = `pill ${connected ? "" : "warning"}`;
    $("#disconnect-wa").classList.toggle("hidden", !connected);

    if (status === "QR_PENDING") {
      const result = await api(`/organizations/${orgId}/whatsapp/qr`);
      $("#qr-container").innerHTML = `<img src="${result.qr}" alt="QR code WhatsApp" />`;
    } else if (!connected) {
      $("#qr-container").innerHTML = '<span>◫</span><p>Le QR code apparaîtra ici</p>';
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
  $("#disconnect-wa").onclick = disconnectWhatsApp;
}
