import { createHmac, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

/**
 * Photos et documents envoyés par les clients (WhatsApp). Rangés par entreprise sur le disque persistant,
 * servis uniquement avec un lien signé et temporaire (une balise <img> ne peut pas envoyer de jeton de connexion).
 */

const IMAGE_TYPES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt", "ods", "zip"]);

export interface StoredClientMedia {
  file: string;
  mimeType: string;
  name: string | null;
}

export function isInlineImageType(mimeType: string | null | undefined) {
  return Boolean(mimeType && IMAGE_TYPES.has(mimeType));
}

/** Choisit l'extension du fichier rangé : jamais une extension dangereuse (html, svg, exe...), même si le client l'envoie. */
export function resolveStoredExtension(mimeType: string, fileName?: string | null): string {
  const fromMime = IMAGE_TYPES.get(mimeType);
  if (fromMime) return fromMime;
  if (mimeType === "application/pdf") return "pdf";
  const fromName = fileName?.split(".").at(-1)?.toLowerCase() ?? "";
  return DOCUMENT_EXTENSIONS.has(fromName) ? fromName : "bin";
}

function organizationDirectory(organizationId: string) {
  return path.join(path.resolve(env.CLIENT_MEDIA_DIR), organizationId);
}

export async function saveClientMedia(organizationId: string, data: Buffer, mimeType: string, fileName?: string | null): Promise<StoredClientMedia> {
  const directory = organizationDirectory(organizationId);
  await fs.mkdir(directory, { recursive: true });
  const file = `${randomUUID()}.${resolveStoredExtension(mimeType, fileName)}`;
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  await fs.writeFile(temporary, data, { flag: "wx" });
  await fs.rename(temporary, path.join(directory, file));
  const safeName = fileName?.replace(/[\r\n"\\/]/g, "_").slice(0, 120) || null;
  return { file, mimeType, name: safeName };
}

const FILE_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i;

export async function readClientMedia(organizationId: string, file: string): Promise<Buffer | null> {
  if (!FILE_PATTERN.test(file)) return null;
  try {
    return await fs.readFile(path.join(organizationDirectory(organizationId), file));
  } catch {
    return null;
  }
}

export async function deleteClientMediaFile(organizationId: string, file: string) {
  if (!FILE_PATTERN.test(file)) return;
  await fs.rm(path.join(organizationDirectory(organizationId), file), { force: true });
}

export function createClientMediaToken(organizationId: string, file: string, issuedAt = Date.now()) {
  const secret = env.MEDIA_SIGNING_SECRET || "development-media-secret";
  const digest = createHmac("sha256", secret).update(`client:${organizationId}:${file}:${issuedAt}`).digest("hex");
  return `${issuedAt}:${digest}`;
}

export function verifyClientMediaToken(organizationId: string, file: string, token: string | undefined, now = Date.now()) {
  if (!token) return false;
  const [issuedAtValue, digest] = token.split(":");
  const issuedAt = Number.parseInt(issuedAtValue ?? "0", 10);
  if (!digest || !Number.isFinite(issuedAt) || now - issuedAt > env.MEDIA_URL_TTL_SECONDS * 1000 || issuedAt > now + 60_000) return false;
  return createClientMediaToken(organizationId, file, issuedAt) === token;
}

/** Chemin relatif signé, à préfixer par l'adresse de l'API côté tableau de bord. */
export function buildClientMediaPath(organizationId: string, file: string, issuedAt = Date.now()) {
  return `/media/client/${organizationId}/${file}?t=${createClientMediaToken(organizationId, file, issuedAt)}`;
}

/** En-têtes sûrs : les images s'affichent, tout le reste se télécharge (jamais exécuté par le navigateur). */
export function clientMediaResponseHeaders(mimeType: string | null | undefined, name: string | null | undefined, file: string) {
  if (isInlineImageType(mimeType)) {
    return { "Content-Type": mimeType!, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" };
  }
  const downloadName = (name || file).replace(/[^\w.\- ]/g, "_");
  return {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${downloadName}"`,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  };
}
