/**
 * Limiteur simple en mémoire (une seule instance du serveur). Les compteurs expirés sont purgés régulièrement
 * pour qu'un attaquant ne puisse pas remplir la mémoire en variant les clés.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 50_000;
let lastPurge = 0;

function purge(now: number) {
  if (now - lastPurge < 30_000 && buckets.size < MAX_BUCKETS) return;
  lastPurge = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Si malgré tout la table reste énorme (attaque), on repart de zéro plutôt que de saturer la mémoire.
  if (buckets.size >= MAX_BUCKETS) buckets.clear();
}

/** Renvoie false quand la limite est atteinte pour cette clé dans la fenêtre. */
export function evaluateRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  purge(now);
  const previous = buckets.get(key);
  if (!previous || previous.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (previous.count >= limit) return false;
  previous.count += 1;
  return true;
}

/** Compte seulement les échecs : la clé est vérifiée avant, puis incrémentée uniquement si la tentative échoue. */
export function isRateLimited(key: string, limit: number, now = Date.now()) {
  const bucket = buckets.get(key);
  return Boolean(bucket && bucket.resetAt > now && bucket.count >= limit);
}

export function recordFailure(key: string, windowMs: number, now = Date.now()) {
  purge(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + windowMs });
  else bucket.count += 1;
}

export function clearRateLimit(key: string) {
  buckets.delete(key);
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
