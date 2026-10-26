import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { MediaQuotaError, createClientMediaToken, saveClientMedia, verifyClientMediaToken } from "./client-media.service.js";
import { createProductImageToken, verifyProductImageToken } from "../products/products.service.js";

const ORG = "11111111-1111-1111-1111-111111111111";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
let directory: string;
const original = { dir: env.CLIENT_MEDIA_DIR, quota: env.CLIENT_MEDIA_QUOTA_MB };

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "brayano-media-"));
  env.CLIENT_MEDIA_DIR = directory;
});
afterAll(() => {
  env.CLIENT_MEDIA_DIR = original.dir;
  env.CLIENT_MEDIA_QUOTA_MB = original.quota;
  rmSync(directory, { recursive: true, force: true });
});

describe("fichiers reçus des clients", () => {
  it("range une vraie image comme image", async () => {
    const stored = await saveClientMedia(ORG, PNG, "image/png", "photo.png");
    expect(stored.mimeType).toBe("image/png");
    expect(stored.file).toMatch(/\.png$/);
  });

  it("ne croit pas le type annoncé : du HTML déclaré « image/png » est rangé comme fichier à télécharger", async () => {
    const stored = await saveClientMedia(ORG, Buffer.from("<html><script>alert(1)</script></html>"), "image/png", "x.png");
    expect(stored.mimeType).toBe("application/octet-stream");
    expect(stored.file).toMatch(/\.bin$/);
  });

  it("refuse d'enregistrer au-delà du quota d'espace de l'entreprise", async () => {
    env.CLIENT_MEDIA_QUOTA_MB = 10;
    await saveClientMedia("33333333-3333-3333-3333-333333333333", Buffer.alloc(6 * 1024 * 1024), "application/pdf", "a.pdf");
    await expect(saveClientMedia("33333333-3333-3333-3333-333333333333", Buffer.alloc(6 * 1024 * 1024), "application/pdf", "b.pdf")).rejects.toBeInstanceOf(MediaQuotaError);
    // Une autre entreprise n'est pas touchée.
    await expect(saveClientMedia("44444444-4444-4444-4444-444444444444", Buffer.alloc(6 * 1024 * 1024), "application/pdf", "c.pdf")).resolves.toBeTruthy();
  });
});

describe("liens signés de médias", () => {
  const FILE = "22222222-2222-2222-2222-222222222222.jpg";
  it("n'acceptent ni un jeton modifié, ni un jeton daté du futur, ni un jeton d'une autre entreprise", () => {
    const now = Date.now();
    const token = createClientMediaToken(ORG, FILE, now);
    expect(verifyClientMediaToken(ORG, FILE, token, now)).toBe(true);
    expect(verifyClientMediaToken(ORG, FILE, `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`, now)).toBe(false);
    expect(verifyClientMediaToken("55555555-5555-5555-5555-555555555555", FILE, token, now)).toBe(false);
    expect(verifyClientMediaToken(ORG, FILE, createClientMediaToken(ORG, FILE, now + 3_600_000), now)).toBe(false);
    expect(verifyClientMediaToken(ORG, FILE, token, now + 2 * 3_600_000)).toBe(false);
    const product = createProductImageToken(ORG, "a.jpg", now);
    expect(verifyProductImageToken(ORG, "a.jpg", product, now)).toBe(true);
    expect(verifyProductImageToken(ORG, "a.jpg", createProductImageToken(ORG, "a.jpg", now + 3_600_000), now)).toBe(false);
    // Un jeton produit n'ouvre pas un média client (domaines de signature séparés).
    expect(verifyClientMediaToken(ORG, "a.jpg", product, now)).toBe(false);
  });
});
