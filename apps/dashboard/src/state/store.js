import { readOrganizationId } from "../services/storage.js";

/**
 * Micro state-store maison : remplace les variables globales éparpillées
 * de l'ancien app.js par un état unique, lisible et observable.
 * Volontairement minimaliste (pas de dépendance externe).
 */
const state = {
  organizationId: readOrganizationId(),
  organizationName: "Brayano",
  organizations: [],
  conversations: [],
  commercialMetrics: [],
  pendingRegistrationEmail: "",
  editingResponsibleId: null,
  agentTestHistory: [],
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((listener) => listener(state));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
