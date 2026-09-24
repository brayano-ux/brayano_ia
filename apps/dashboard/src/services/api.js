import { getApiBaseUrl } from "../config.js";
import { readSession } from "./storage.js";

export async function api(path, options = {}) {
  const session = readSession();
  const headers = new Headers(options.headers || {});

  if (session?.token) {
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error((typeof payload === "string" ? payload : payload.message) || "La requête a échoué.");
  }

  if (response.status === 204) return null;
  return typeof payload === "string" ? payload : payload;
}
