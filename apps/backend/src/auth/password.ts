import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Mots de passe : scrypt avec un sel aléatoire par mot de passe, au format « scrypt$N$r$p$sel$empreinte ».
 * Les anciennes empreintes (SHA-256 sans sel, 64 caractères hexadécimaux) restent acceptées à la connexion
 * puis sont remplacées par une empreinte scrypt (voir `needsRehash`).
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

const LEGACY_HASH = /^[0-9a-f]{64}$/;

function legacyHash(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

function sameText(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Empreinte factice : sert à faire le même travail quand le compte n'existe pas (pas de différence de durée). */
let dummyHash: Promise<string> | null = null;
function getDummyHash() {
  dummyHash ??= hashPassword("mot-de-passe-factice-brayano");
  return dummyHash;
}

export async function verifyPassword(password: string, storedHash: string | undefined | null): Promise<boolean> {
  if (!storedHash) {
    await derive(password, Buffer.alloc(16), N, R, P).catch(() => undefined);
    return false;
  }
  if (LEGACY_HASH.test(storedHash)) return sameText(legacyHash(password), storedHash);

  const [scheme, n, r, p, saltHex, keyHex] = storedHash.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltHex || !keyHex) return false;
  const params = [Number(n), Number(r), Number(p)];
  if (params.some((value) => !Number.isInteger(value) || value < 1) || params[0]! > 1 << 20) return false;
  try {
    const expected = Buffer.from(keyHex, "hex");
    const candidate = await derive(password, Buffer.from(saltHex, "hex"), params[0]!, params[1]!, params[2]!);
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
  } catch {
    return false;
  }
}

/** Vrai pour une ancienne empreinte (SHA-256) ou des paramètres plus faibles que ceux d'aujourd'hui. */
export function needsRehash(storedHash: string | undefined | null): boolean {
  if (!storedHash) return false;
  if (LEGACY_HASH.test(storedHash)) return true;
  const [scheme, n] = storedHash.split("$");
  return scheme === "scrypt" && Number(n) < N;
}

/** À appeler quand le compte n'existe pas : dépense le même temps qu'une vraie vérification. */
export async function burnPasswordCheck(password: string) {
  await verifyPassword(password, await getDummyHash());
}

/** Comparaison en temps constant de deux textes (ex. mot de passe d'administrateur défini dans l'environnement). */
export function safeEqualText(a: string, b: string) {
  return sameText(createHash("sha256").update(a).digest("hex"), createHash("sha256").update(b).digest("hex"));
}
