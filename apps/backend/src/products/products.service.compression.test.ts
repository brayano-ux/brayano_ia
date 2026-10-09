import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "product-images-"));
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  env: { PRODUCT_IMAGE_DIR: "", MEDIA_SIGNING_SECRET: "test-secret-0123456789", MEDIA_URL_TTL_SECONDS: 3600 },
}));
mocks.env.PRODUCT_IMAGE_DIR = dir;
vi.mock("../config/env.js", () => ({ env: mocks.env }));
vi.mock("../database/client.js", () => ({ prisma: { product: { findFirst: mocks.findFirst, update: mocks.update } } }));

import { saveProductImage } from "./products.service.js";

const ORG = "11111111-1111-1111-1111-111111111111";
const PRODUCT = "22222222-2222-2222-2222-222222222222";
const noisy = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } });
const stored = () => fs.readdirSync(path.join(dir, ORG)).sort();

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("saveProductImage with compression", () => {
  beforeEach(() => {
    fs.rmSync(path.join(dir, ORG), { recursive: true, force: true });
    mocks.findFirst.mockResolvedValue({ id: PRODUCT, organizationId: ORG });
    mocks.update.mockImplementation(async ({ data }) => ({ id: PRODUCT, ...data }));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("stores a heavy PNG as a much lighter JPEG and points the product to it", async () => {
    const png = await noisy(1100, 800).png().toBuffer();
    expect(png.length).toBeLessThan(5 * 1024 * 1024); // accepté par la limite de 5 Mo
    const product = await saveProductImage(ORG, PRODUCT, "image/png", png, "https://api.example.com");
    expect(stored()).toEqual([`${PRODUCT}.jpg`]);
    const file = fs.readFileSync(path.join(dir, ORG, `${PRODUCT}.jpg`));
    expect((await sharp(file).metadata()).format).toBe("jpeg");
    expect(file.length).toBeLessThan(png.length * 0.6);
    expect(product.imageUrl).toContain(`/media/products/${ORG}/${PRODUCT}.jpg?t=`);
  });

  it("removes the previous photo when the format changes", async () => {
    fs.mkdirSync(path.join(dir, ORG), { recursive: true });
    fs.writeFileSync(path.join(dir, ORG, `${PRODUCT}.png`), "old");
    fs.writeFileSync(path.join(dir, ORG, `${PRODUCT}.webp`), "old");
    const jpeg = await noisy(1200, 900).jpeg({ quality: 95 }).toBuffer();
    await saveProductImage(ORG, PRODUCT, "image/jpeg", jpeg, "https://api.example.com");
    expect(stored()).toEqual([`${PRODUCT}.jpg`]);
  });

  it("still rejects what was already rejected before (wrong type, fake content, too heavy)", async () => {
    await expect(saveProductImage(ORG, PRODUCT, "image/gif", Buffer.from("GIF89a"), "https://x")).rejects.toThrow("Format accepté");
    await expect(saveProductImage(ORG, PRODUCT, "image/png", Buffer.from("not a png"), "https://x")).rejects.toThrow("ne correspond pas");
    await expect(saveProductImage(ORG, PRODUCT, "image/jpeg", Buffer.alloc(5 * 1024 * 1024 + 1), "https://x")).rejects.toThrow("5 Mo");
    expect(fs.existsSync(path.join(dir, ORG))).toBe(false);
  });

  it("still saves the original photo when the file cannot be compressed", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("valid signature, damaged content")]);
    await saveProductImage(ORG, PRODUCT, "image/jpeg", fake, "https://api.example.com");
    expect(fs.readFileSync(path.join(dir, ORG, `${PRODUCT}.jpg`))).toEqual(fake);
  });

  it("does not leave the new file behind when the database update fails", async () => {
    mocks.update.mockRejectedValue(new Error("db down"));
    const jpeg = await noisy(800, 600).jpeg().toBuffer();
    await expect(saveProductImage(ORG, PRODUCT, "image/jpeg", jpeg, "https://x")).rejects.toThrow("db down");
    expect(stored().filter((name) => name.endsWith(".jpg"))).toEqual([]);
  });
});
