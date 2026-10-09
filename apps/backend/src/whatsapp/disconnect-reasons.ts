import type { ConnectionLossReason } from "./whatsapp.types.js";

/** Codes de fermeture renvoyés par WhatsApp (bibliothèque Baileys), expliqués en français. */
const CLOSE_CODES: Record<number, string> = {
  401: "Déconnecté depuis le téléphone (Appareils liés) ou session fermée par WhatsApp",
  403: "Accès refusé par WhatsApp : le numéro est peut-être restreint ou banni",
  408: "Délai de connexion dépassé",
  411: "Version WhatsApp multi-appareils incompatible",
  428: "Connexion fermée par WhatsApp ou par le réseau",
  440: "Session ouverte ailleurs : un autre serveur utilise le même numéro",
  500: "Session corrompue",
  515: "WhatsApp demande de relancer la connexion",
};

export function describeCloseCode(statusCode: number | undefined): string {
  if (statusCode === undefined) return "Connexion fermée, cause inconnue";
  const label = CLOSE_CODES[statusCode] ?? "Connexion fermée";
  return `${label} (code ${statusCode})`;
}

/**
 * Données à enregistrer sur le compte WhatsApp pour garder l'historique : dernière connexion,
 * dernière déconnexion et sa cause. Un statut « QR à scanner » n'efface pas la cause de la déconnexion qui l'a précédé.
 */
export function buildAccountHistoryUpdate(
  update: { status: "DISCONNECTED" | "QR_PENDING" | "CONNECTED"; reason?: ConnectionLossReason; detail?: string },
  now: Date,
) {
  if (update.status === "CONNECTED") return { lastConnectedAt: now };
  if (update.status === "QR_PENDING") return {};
  const reason = update.detail ?? (update.reason === "manual" ? "Déconnexion volontaire" : "Cause inconnue");
  return { lastDisconnectedAt: now, lastDisconnectReason: reason };
}
