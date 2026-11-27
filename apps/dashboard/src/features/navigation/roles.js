import { readSession, writeSession } from "../../services/storage.js";
import { api } from "../../services/api.js";

/**
 * Rôles : le propriétaire (ADMIN) voit tout ; un employé (AGENT) répond aux clients et suit commandes et rendez-vous.
 * Le serveur applique les mêmes limites (shared/permissions.ts) : masquer ici n'est qu'un confort d'affichage.
 */
export const ADMIN_ONLY_VIEWS = ["agent", "products", "broadcasts", "whatsapp", "billing", "settings"];
/** Pages réservées aux administrateurs de la plateforme (PLATFORM_ADMIN_EMAILS) : le serveur refuse les autres comptes. */
export const PLATFORM_ONLY_VIEWS = ["clients"];

export function isAgentRole() {
  return document.body.classList.contains("role-agent");
}

export function applyRole(role) {
  document.body.classList.toggle("role-agent", role === "AGENT");
}

export function isPlatformAdmin() {
  return document.body.classList.contains("platform-admin");
}

export function applyPlatformAdmin(value) {
  document.body.classList.toggle("platform-admin", Boolean(value));
}

/** La page est-elle interdite au compte connecté ? (employé sur une page de réglages, ou page réservée à la plateforme) */
export function isViewForbidden(view) {
  if (PLATFORM_ONLY_VIEWS.includes(view)) return !isPlatformAdmin();
  return isAgentRole() && ADMIN_ONLY_VIEWS.includes(view);
}

/** Lit le rôle auprès du serveur, le mémorise dans la session et adapte l'affichage. Renvoie le rôle. */
export async function loadRole() {
  try {
    const me = await api("/me");
    const role = me.user?.role === "AGENT" ? "AGENT" : "ADMIN";
    const session = readSession();
    const platformAdmin = me.user?.platformAdmin === true;
    if (session) writeSession({ ...session, role, name: me.user?.name || null, platformAdmin });
    applyRole(role);
    applyPlatformAdmin(platformAdmin);
    return role;
  } catch {
    applyRole(readSession()?.role === "AGENT" ? "AGENT" : "ADMIN");
    applyPlatformAdmin(readSession()?.platformAdmin === true);
    return readSession()?.role || "ADMIN";
  }
}
