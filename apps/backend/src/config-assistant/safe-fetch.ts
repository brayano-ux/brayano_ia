import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { ValidationError } from "../shared/errors.js";

/**
 * Récupération d'une page web fournie par un utilisateur, protégée contre le SSRF :
 * - http/https uniquement, ports 80/443 uniquement, pas d'identifiants dans l'URL ;
 * - l'adresse IP est résolue puis VÉRIFIÉE, et la connexion est ÉPINGLÉE sur cette IP
 *   (pas de seconde résolution DNS => pas de « DNS rebinding ») ;
 * - redirections suivies à la main (3 max), chacune revalidée ;
 * - délai et taille plafonnés.
 */

const blocked = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 0) return true;
  if (version === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isBlockedAddress(mapped[1]!);
  }
  return blocked.check(address, version === 4 ? "ipv4" : "ipv6");
}

export function parsePublicUrl(raw: string, testAllowHost?: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError("Adresse du site invalide. Exemple : https://www.monentreprise.com");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ValidationError("Seules les adresses http et https sont acceptées.");
  if (url.username || url.password) throw new ValidationError("L'adresse ne doit pas contenir d'identifiants.");
  if (testAllowHost && url.host === testAllowHost) return url;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "80" && port !== "443") throw new ValidationError("Ce port n'est pas autorisé.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ValidationError("Cette adresse n'est pas accessible publiquement.");
  }
  return url;
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Réservé aux tests : « hôte:port » d'un serveur local autorisé. Jamais passé par une route. */
  testAllowHost?: string;
}

export interface FetchedPage {
  finalUrl: string;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

async function resolvePublicAddress(hostname: string, allowPrivate: boolean) {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(bare)
    ? [{ address: bare, family: net.isIP(bare) }]
    : await dns.lookup(bare, { all: true }).catch(() => {
        throw new ValidationError("Ce site est introuvable (nom de domaine inconnu).");
      });
  if (addresses.length === 0) throw new ValidationError("Ce site est introuvable.");
  if (!allowPrivate && addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new ValidationError("Cette adresse n'est pas accessible publiquement.");
  }
  return addresses[0]!;
}

function requestOnce(url: URL, pinned: { address: string; family: number }, options: Required<Pick<SafeFetchOptions, "maxBytes" | "timeoutMs">>) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: net.isIP(url.hostname) ? undefined : url.hostname,
        headers: {
          Host: url.host,
          "User-Agent": "BrayanoAI-ConfigAssistant/1.0 (+lecture d'une page publique à la demande du propriétaire)",
          Accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "identity",
        },
        lookup: ((_host: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          // Connexion épinglée sur l'IP déjà vérifiée (pas de seconde résolution DNS).
          if (lookupOptions?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
          else callback(null, pinned.address, pinned.family);
        }) as never,
        timeout: options.timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - options.maxBytes)));
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks), truncated });
        response.on("end", finish);
        response.on("close", finish);
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new ValidationError("Le site met trop de temps à répondre.")));
    request.on("error", (error) => reject(error instanceof ValidationError ? error : new ValidationError("Impossible de lire ce site pour le moment.")));
    request.end();
  });
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchedPage> {
  const maxBytes = options.maxBytes ?? 1_500_000;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRedirects = options.maxRedirects ?? 3;

  let url = parsePublicUrl(rawUrl, options.testAllowHost);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const pinned = await resolvePublicAddress(url.hostname, options.testAllowHost !== undefined && url.host === options.testAllowHost);
    const response = await requestOnce(url, pinned, { maxBytes, timeoutMs });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location) throw new ValidationError("Redirection invalide.");
      url = parsePublicUrl(new URL(location, url).toString(), options.testAllowHost);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ValidationError(`Le site a répondu avec une erreur (${response.status}).`);
    }
    const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
    if (!/^(text\/html|text\/plain|application\/xhtml\+xml)/.test(contentType)) {
      throw new ValidationError("Cette adresse ne renvoie pas une page web lisible (HTML ou texte).");
    }
    return { finalUrl: url.toString(), contentType, body: response.body, truncated: response.truncated };
  }
  throw new ValidationError("Trop de redirections.");
}
