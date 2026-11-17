import { createHmac, createPublicKey, createVerify, timingSafeEqual, type JsonWebKey } from "node:crypto";

/**
 * Connexion avec Google (Google Identity Services). Le navigateur reçoit de Google un « jeton d'identité » (JWT signé
 * par Google) et nous l'envoie. On le vérifie nous-mêmes, sans dépendance : signature RS256 avec les clés publiques
 * de Google, émetteur, destinataire (notre identifiant client), expiration et email vérifié.
 */

export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
/** Tolérance d'horloge entre notre serveur et Google. */
const CLOCK_SKEW_SECONDS = 60;
const DEFAULT_KEYS_TTL_MS = 60 * 60_000;

export interface GoogleIdentity {
  /** Identifiant Google stable de la personne. */
  sub: string;
  email: string;
  name: string | null;
}

export class GoogleAuthError extends Error {}

type Jwk = JsonWebKey & { kid?: string; alg?: string };
type KeyFetcher = () => Promise<{ keys: Jwk[]; maxAgeMs: number }>;

async function fetchGoogleKeys(): Promise<{ keys: Jwk[]; maxAgeMs: number }> {
  const response = await fetch(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new GoogleAuthError(`Clés Google indisponibles (${response.status}).`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const maxAge = /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1];
  return { keys: Array.isArray(body.keys) ? body.keys : [], maxAgeMs: maxAge ? Number(maxAge) * 1000 : DEFAULT_KEYS_TTL_MS };
}

let cachedKeys: { keys: Jwk[]; expiresAt: number } | null = null;

/** Clé publique Google correspondant à `kid`. Les clés tournent : une clé inconnue déclenche un rechargement. */
async function findKey(kid: string, fetchKeys: KeyFetcher, now: number): Promise<Jwk | null> {
  const lookup = () => cachedKeys?.keys.find((key) => key.kid === kid) ?? null;
  if (cachedKeys && cachedKeys.expiresAt > now && lookup()) return lookup();
  const fresh = await fetchKeys();
  cachedKeys = { keys: fresh.keys, expiresAt: now + fresh.maxAgeMs };
  return lookup();
}

function decodePart<T>(part: string): T {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
  } catch {
    throw new GoogleAuthError("Jeton Google illisible.");
  }
}

export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
  options: { fetchKeys?: KeyFetcher; now?: () => number } = {},
): Promise<GoogleIdentity> {
  const now = options.now ?? Date.now;
  const parts = credential.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new GoogleAuthError("Jeton Google mal formé.");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodePart<{ alg?: string; kid?: string }>(headerPart);
  if (header.alg !== "RS256" || !header.kid) throw new GoogleAuthError("Jeton Google : algorithme non accepté.");

  const jwk = await findKey(header.kid, options.fetchKeys ?? fetchGoogleKeys, now());
  if (!jwk) throw new GoogleAuthError("Jeton Google : clé de signature inconnue.");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerPart}.${payloadPart}`);
  const validSignature = verifier.verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signaturePart, "base64url"));
  if (!validSignature) throw new GoogleAuthError("Jeton Google : signature invalide.");

  const payload = decodePart<{ iss?: string; aud?: string; exp?: number; iat?: number; sub?: string; email?: string; email_verified?: boolean | string; name?: string }>(payloadPart);
  const nowSeconds = Math.floor(now() / 1000);
  if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) throw new GoogleAuthError("Jeton Google : émetteur inconnu.");
  if (payload.aud !== clientId) throw new GoogleAuthError("Jeton Google destiné à une autre application.");
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) throw new GoogleAuthError("Jeton Google expiré. Reconnectez-vous.");
  if (typeof payload.iat === "number" && payload.iat - CLOCK_SKEW_SECONDS > nowSeconds) throw new GoogleAuthError("Jeton Google émis dans le futur.");
  if (!payload.sub || !payload.email) throw new GoogleAuthError("Jeton Google incomplet.");
  // Sans email vérifié par Google, n'importe qui pourrait se présenter avec l'adresse d'un autre.
  if (payload.email_verified !== true && payload.email_verified !== "true") throw new GoogleAuthError("Votre adresse Google n'est pas vérifiée.");

  return { sub: payload.sub, email: payload.email.trim().toLowerCase(), name: payload.name?.trim() || null };
}

/** Réservé aux tests : oublie les clés Google en mémoire. */
export function resetGoogleKeysForTests() {
  cachedKeys = null;
}

/**
 * Jeton d'inscription en attente : Google a confirmé l'email, il ne manque que le nom de l'entreprise. Signé par le
 * serveur (HMAC) et valable 30 minutes, il évite une table de plus et ne peut pas être fabriqué par le navigateur.
 */
const SIGNUP_TOKEN_TTL_MS = 30 * 60_000;

export interface PendingGoogleSignup {
  email: string;
  name: string | null;
  sub: string;
}

function signupSignature(payload: string, secret: string) {
  return createHmac("sha256", `google-signup:${secret}`).update(payload).digest("base64url");
}

export function createGoogleSignupToken(identity: PendingGoogleSignup, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...identity, exp: now + SIGNUP_TOKEN_TTL_MS })).toString("base64url");
  return `${payload}.${signupSignature(payload, secret)}`;
}

export function readGoogleSignupToken(token: string, secret: string, now = Date.now()): PendingGoogleSignup | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(signupSignature(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<PendingGoogleSignup> & { exp?: number };
    if (typeof data.exp !== "number" || data.exp < now || !data.email || !data.sub) return null;
    return { email: data.email, name: data.name ?? null, sub: data.sub };
  } catch {
    return null;
  }
}
