import { APP_CONFIG } from "../config.js";

const { session: SESSION_KEY, organization: ORG_KEY } = APP_CONFIG.localStorageKeys;

export function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export function writeSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function isAuthenticated() {
  const session = readSession();
  return Boolean(session?.email && session?.token);
}

export function readOrganizationId() {
  return localStorage.getItem(ORG_KEY) || null;
}

export function writeOrganizationId(id) {
  if (id) {
    localStorage.setItem(ORG_KEY, id);
  }
}
