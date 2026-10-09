import { ValidationError } from "../shared/errors.js";
import { findUsefulLinks, htmlToText } from "./html-text.js";
import { safeFetch } from "./safe-fetch.js";

export const MAX_SOURCE_CHARS = 40_000;

export interface PreparedSource {
  kind: "text" | "url" | "pdf";
  label: string;
  text: string;
  truncated: boolean;
}

export function prepareTextSource(raw: string): PreparedSource {
  const text = raw.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (text.length < 20) throw new ValidationError("Le texte est trop court pour en tirer des informations (20 caractères minimum).");
  return { kind: "text", label: "Texte collé", text: text.slice(0, MAX_SOURCE_CHARS), truncated: text.length > MAX_SOURCE_CHARS };
}

export async function prepareUrlSource(rawUrl: string): Promise<PreparedSource> {
  const first = await safeFetch(rawUrl);
  const firstHtml = first.body.toString("utf8");
  const parts = [`--- PAGE : ${first.finalUrl} ---\n${first.contentType.startsWith("text/plain") ? firstHtml : htmlToText(firstHtml, 25_000)}`];

  if (first.contentType.includes("html")) {
    for (const link of findUsefulLinks(firstHtml, first.finalUrl)) {
      try {
        const page = await safeFetch(link, { maxBytes: 800_000, timeoutMs: 8_000 });
        if (page.contentType.includes("html")) parts.push(`--- PAGE : ${page.finalUrl} ---\n${htmlToText(page.body.toString("utf8"), 10_000)}`);
      } catch {
        // une page secondaire illisible n'empêche pas l'analyse
      }
    }
  }

  const joined = parts.join("\n\n");
  if (joined.replace(/--- PAGE : [^\n]+ ---/g, "").trim().length < 40) {
    throw new ValidationError("Cette page ne contient pas de texte lisible (site entièrement en JavaScript ?). Collez plutôt le texte de vos pages.");
  }
  return { kind: "url", label: first.finalUrl, text: joined.slice(0, MAX_SOURCE_CHARS), truncated: joined.length > MAX_SOURCE_CHARS || first.truncated };
}

export async function preparePdfSource(buffer: Buffer): Promise<PreparedSource> {
  if (buffer.length < 8 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new ValidationError("Ce fichier n'est pas un PDF valide.");
  }
  let text = "";
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    if (pdf.numPages > 60) throw new ValidationError("Ce PDF a trop de pages (60 maximum). Collez plutôt les parties utiles.");
    text = (await extractText(pdf, { mergePages: true })).text;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Impossible de lire ce PDF (fichier protégé ou abîmé).");
  }
  text = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 40) {
    throw new ValidationError("Ce PDF ne contient pas de texte sélectionnable (document scanné ?). Collez le texte à la place.");
  }
  return { kind: "pdf", label: "Document PDF", text: text.slice(0, MAX_SOURCE_CHARS), truncated: text.length > MAX_SOURCE_CHARS };
}
