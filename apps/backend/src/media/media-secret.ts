import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

/** Secret qui signe les liens de photos. Jamais de valeur par défaut : sans secret, le serveur ne démarre pas (sauf en test). */
export function getMediaSecret(): string {
  if (env.MEDIA_SIGNING_SECRET) return env.MEDIA_SIGNING_SECRET;
  if (env.NODE_ENV === "test") return "secret-de-test-uniquement-0123456789";
  throw new Error("MEDIA_SIGNING_SECRET n'est pas défini.");
}

/** Comparaison de deux jetons en temps constant. */
export function sameToken(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
