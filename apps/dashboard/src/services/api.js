import { getApiBaseUrl } from "../config.js";
import { readSession } from "./storage.js";

/**
 * Client HTTP unique du dashboard. Toute feature métier passe par ici
 * afin de garder l'authentification et la gestion d'erreurs cohérentes.
 */
export async function api(path, options = {}) {
  const session = readSession();
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
    throw new Error((typeof payload === "string" ? payload : payload.message) || "La requête a échoué.");
  }

  if (response.status === 204) return null;
  return payload;
}

export function isNetworkError(error) {
  const message = error?.message || "";
  return message.includes("Failed to fetch") || message.includes("fetch") || message.includes("Network");
}
