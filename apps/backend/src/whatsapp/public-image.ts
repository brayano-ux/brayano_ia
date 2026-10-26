import { env } from "../config/env.js";
import { isBlockedAddress, parsePublicUrl, safeFetch } from "../config-assistant/safe-fetch.js";
import { ValidationError } from "../shared/errors.js";

/** Taille maximale d'une image envoyée à un client. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/i;

export interface PublicImage {
  data: Buffer;
  mimeType: string;
}

/** Reconnaît le vrai type d'une image à ses premiers octets (jamais à ce que l'expéditeur déclare). */
export function detectImageType(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Hôte du serveur de l'application : ses propres liens de photos signés ne passent pas par le filtre d'adresses. */
function ownHosts(): string[] {
  try {
    return [new URL(env.APP_URL).host];
  } catch {
    return [];
  }
}

/** Vérification immédiate (sans réseau) d'une adresse d'image à l'enregistrement. Lève ValidationError si elle est refusée. */
export function assertAcceptableImageUrl(value: string): void {
  const text = value.trim();
  if (!text) return;
  if (/^data:/i.test(text)) {
    if (!DATA_IMAGE.test(text) || text.length > Math.ceil(MAX_IMAGE_BYTES * 1.4)) {
      throw new ValidationError("L'image doit être au format JPEG, PNG ou WebP (5 Mo maximum).");
    }
    return;
  }
  const url = parsePublicUrl(text);
  if (ownHosts().includes(url.host)) return;
  const bare = url.hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$|:/.test(bare) && isBlockedAddress(bare)) throw new ValidationError("Cette adresse n'est pas accessible publiquement.");
}

/**
 * Charge une image à envoyer à un client : toujours via le téléchargeur sécurisé (pas d'adresse interne, redirections
 * revérifiées, taille et durée plafonnées), puis contrôle du vrai format. Le serveur ne transmet jamais une URL brute à WhatsApp.
 */
export async function loadImageForSending(value: string): Promise<PublicImage> {
  const text = value.trim();
  const dataUrl = DATA_IMAGE.exec(text);
  if (dataUrl) {
    const data = Buffer.from(dataUrl[2]!.replace(/\s+/g, ""), "base64");
    return checked(data);
  }
  if (/^data:|^blob:/i.test(text)) throw new ValidationError("Format d'image non pris en charge.");

  const page = await safeFetch(text, {
    maxBytes: MAX_IMAGE_BYTES,
    totalTimeoutMs: 20_000,
    accept: "image/jpeg,image/png,image/webp;q=0.9",
    allowedContentType: /^image\/(jpeg|png|webp)/,
    trustedHosts: ownHosts(),
  });
  if (page.truncated) throw new ValidationError("L'image est trop lourde (5 Mo maximum).");
  return checked(page.body);
}

function checked(data: Buffer): PublicImage {
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES) throw new ValidationError("L'image est vide ou trop lourde (5 Mo maximum).");
  const mimeType = detectImageType(data);
  if (!mimeType) throw new ValidationError("Le fichier n'est pas une image JPEG, PNG ou WebP.");
  return { data, mimeType };
}
