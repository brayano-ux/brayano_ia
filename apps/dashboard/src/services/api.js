import { getApiBaseUrl } from "../config.js";
import { clearSession, readSession } from "./storage.js";

let unauthorizedHandler = () => {};

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export function isAuthenticationError(error) {
  return error?.status === 401;
}

/**
 * Client HTTP unique du dashboard. Toute feature métier passe par ici
 * afin de garder l'authentification et la gestion d'erreurs cohérentes.
 */
export async function api(path, options = {}) {
  const session = readSession();
  const protectedRequest = path === "/me" || path.startsWith("/organizations");
  if (protectedRequest && !session?.token) {
    const error = new Error("Connectez-vous pour accéder à votre espace.");
    error.status = 401;
    throw error;
  }
  const headers = new Headers(options.headers || {});

  if (session?.token) {
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  const hasBody = options.body !== undefined && options.body !== null && options.body !== "";
  if (hasBody && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, { ...options, headers });
  } catch {
    throw new Error("Failed to fetch");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok) {
    const error = new Error((typeof payload === "string" ? payload : payload.message) || "La requête a échoué.");
    error.status = response.status;
    // Une réponse tardive d’une ancienne session ne doit pas déconnecter la nouvelle.
    if (response.status === 401 && protectedRequest && session?.token && readSession()?.token === session.token) {
      clearSession();
      unauthorizedHandler();
    }
    throw error;
  }

  if (response.status === 204) return null;
  return payload;
}

export function isNetworkError(error) {
  const message = error?.message || "";
  return message.includes("Failed to fetch") || message.includes("fetch") || message.includes("Network");
}
