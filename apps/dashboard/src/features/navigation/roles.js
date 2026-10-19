import { $ } from "../../utils/dom.js";
import { readSession, writeSession } from "../../services/storage.js";
import { api } from "../../services/api.js";

/**
 * Rôles : le propriétaire (ADMIN) voit tout ; un employé (AGENT) répond aux clients et suit commandes et rendez-vous.
 * Le serveur applique les mêmes limites (shared/permissions.ts) : masquer ici n'est qu'un confort d'affichage.
 */
export const ADMIN_ONLY_VIEWS = ["agent", "products", "broadcasts", "whatsapp", "settings"];

export function isAgentRole() {
  return document.body.classList.contains("role-agent");
}

export function applyRole(role) {
  document.body.classList.toggle("role-agent", role === "AGENT");
}

/** Lit le rôle auprès du serveur, le mémorise dans la session et adapte l'affichage. Renvoie le rôle. */
export async function loadRole() {
  try {
    const me = await api("/me");
    const role = me.user?.role === "AGENT" ? "AGENT" : "ADMIN";
    const session = readSession();
    if (session) writeSession({ ...session, role });
    applyRole(role);
    const label = $("#user-email");
    if (label && role === "AGENT") label.textContent = `${me.user.email} · Employé`;
    return role;
  } catch {
    applyRole(readSession()?.role === "AGENT" ? "AGENT" : "ADMIN");
    return readSession()?.role || "ADMIN";
  }
}
