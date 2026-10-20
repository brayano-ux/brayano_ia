import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PRODUCT_IMAGE_DIR = `/tmp/brayano-test-product-images-${process.pid}`;
});

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { buildServer } from "../app.js";
import { prisma } from "../database/client.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "../test-support/integration.js";
import { backfillProductImageCopies, createProductImageToken, readProductImage, saveProductImage } from "./products.service.js";

const IMAGE_DIR = process.env.PRODUCT_IMAGE_DIR!;

async function photo(color: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 300, height: 200, channels: 3, background: color } }).jpeg().toBuffer();
}

describe.skipIf(!integrationEnabled)("photos de produits durables (base réelle)", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildServer({ restoreConnections: false }); });
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
    rmSync(IMAGE_DIR, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetDatabase();
    rmSync(IMAGE_DIR, { recursive: true, force: true });
  });

  async function setup(name = "Sac en cuir") {
    const { organization } = await createTestOrganization();
    const product = await prisma.product.create({ data: { organizationId: organization.id, name, description: "Joli sac" } });
    return { organization, product };
  }

  it("la photo revient toute seule après que le disque a été vidé (redéploiement sans disque persistant)", async () => {
    const { organization, product } = await setup();
    const saved = await saveProductImage(organization.id, product.id, "image/jpeg", await photo({ r: 200, g: 30, b: 30 }), "https://api.example.com");
    const filename = `${product.id}.jpg`;
    expect(existsSync(path.join(IMAGE_DIR, organization.id, filename))).toBe(true);

    rmSync(IMAGE_DIR, { recursive: true, force: true }); // le serveur redémarre avec un disque vide
    expect(existsSync(path.join(IMAGE_DIR, organization.id, filename))).toBe(false);

    const image = await readProductImage(organization.id, filename);
    expect(image?.mimeType).toBe("image/jpeg");
    expect((await sharp(image!.contents).metadata()).format).toBe("jpeg");
    expect(existsSync(path.join(IMAGE_DIR, organization.id, filename))).toBe(true); // refait sur le disque
    expect(saved.imageUrl).toContain(filename);
  });

  it("le lien signé que WhatsApp télécharge répond encore (200) après un disque vidé", async () => {
    const { organization, product } = await setup();
    const saved = await saveProductImage(organization.id, product.id, "image/jpeg", await photo({ r: 10, g: 120, b: 200 }), "http://localhost");
    rmSync(IMAGE_DIR, { recursive: true, force: true });

    const url = new URL(saved.imageUrl!);
    const response = await app.inject({ method: "GET", url: `${url.pathname}${url.search}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(response.rawPayload.length).toBeGreaterThan(100);
  });

  it("remplacer la photo remplace aussi la copie en base", async () => {
    const { organization, product } = await setup();
    await saveProductImage(organization.id, product.id, "image/jpeg", await photo({ r: 255, g: 0, b: 0 }), "https://api.example.com");
    const second = await photo({ r: 0, g: 0, b: 255 });
    await saveProductImage(organization.id, product.id, "image/jpeg", second, "https://api.example.com");
    rmSync(IMAGE_DIR, { recursive: true, force: true });

    const image = await readProductImage(organization.id, `${product.id}.jpg`);
    const { data } = await sharp(image!.contents).raw().toBuffer({ resolveWithObject: true });
    expect(data[2]).toBeGreaterThan(200); // bleu
    expect(await prisma.productImage.count({ where: { productId: product.id } })).toBe(1);
  });

  it("copie au démarrage les anciennes photos qui n'existent que sur le disque", async () => {
    const { organization, product } = await setup();
    const other = await prisma.product.create({ data: { organizationId: organization.id, name: "Externe", description: "x", imageUrl: "https://cdn.example.com/photo.jpg" } });
    const lost = await prisma.product.create({ data: { organizationId: organization.id, name: "Perdue", description: "x", imageUrl: `https://api.example.com/media/products/${organization.id}/${"3".repeat(8)}-3333-3333-3333-${"3".repeat(12)}.jpg?t=1:abc` } });
    mkdirSync(path.join(IMAGE_DIR, organization.id), { recursive: true });
    writeFileSync(path.join(IMAGE_DIR, organization.id, `${product.id}.jpg`), await photo({ r: 5, g: 5, b: 5 }));
    await prisma.product.update({ where: { id: product.id }, data: { imageUrl: `https://api.example.com/media/products/${organization.id}/${product.id}.jpg?t=1:abc` } });

    const result = await backfillProductImageCopies();
    expect(result).toEqual({ copied: 1, missingOnDisk: 0 }); // `lost` n'a pas un nom de fichier valide : ignorée
    expect(await prisma.productImage.findUnique({ where: { productId: product.id } })).not.toBeNull();
    expect(await prisma.productImage.findUnique({ where: { productId: other.id } })).toBeNull();
    expect(await prisma.productImage.findUnique({ where: { productId: lost.id } })).toBeNull();

    rmSync(IMAGE_DIR, { recursive: true, force: true });
    expect(await readProductImage(organization.id, `${product.id}.jpg`)).not.toBeNull();
    expect(await backfillProductImageCopies()).toEqual({ copied: 0, missingOnDisk: 0 }); // rien à refaire
  });

  it("compte les photos introuvables sur le disque sans échouer", async () => {
    const { organization, product } = await setup();
    await prisma.product.update({ where: { id: product.id }, data: { imageUrl: `https://api.example.com/media/products/${organization.id}/${product.id}.png?t=1:abc` } });
    expect(await backfillProductImageCopies()).toEqual({ copied: 0, missingOnDisk: 1 });
  });

  it("une autre entreprise ne peut pas lire la photo, même en connaissant le nom du fichier", async () => {
    const { organization, product } = await setup();
    const { organization: other } = await createTestOrganization("Autre boutique");
    await saveProductImage(organization.id, product.id, "image/jpeg", await photo({ r: 1, g: 2, b: 3 }), "https://api.example.com");
    rmSync(IMAGE_DIR, { recursive: true, force: true });
    expect(await readProductImage(other.id, `${product.id}.jpg`)).toBeNull();
    const token = createProductImageToken(other.id, `${product.id}.jpg`);
    const response = await app.inject({ method: "GET", url: `/media/products/${other.id}/${product.id}.jpg?t=${token}` });
    expect(response.statusCode).toBe(404);
  });

  it("supprimer le produit supprime la copie en base", async () => {
    const { organization, product } = await setup();
    await saveProductImage(organization.id, product.id, "image/jpeg", await photo({ r: 9, g: 9, b: 9 }), "https://api.example.com");
    await prisma.product.delete({ where: { id: product.id } });
    expect(await prisma.productImage.count()).toBe(0);
  });
});
