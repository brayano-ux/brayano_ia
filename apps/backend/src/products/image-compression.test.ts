import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compressProductImage, MAX_IMAGE_SIDE, type SharpLoader } from "./image-compression.js";

const noisy = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } });

describe("compressProductImage", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("shrinks a large phone photo to a light JPEG", async () => {
    const photo = await noisy(3000, 2000).jpeg({ quality: 95 }).toBuffer();
    const result = await compressProductImage(photo, "jpg");
    const meta = await sharp(result.contents).metadata();
    expect(result.compressed).toBe(true);
    expect(result.extension).toBe("jpg");
    expect(Math.max(meta.width!, meta.height!)).toBe(MAX_IMAGE_SIDE);
    expect(meta.format).toBe("jpeg");
    expect(result.contents.length).toBeLessThan(photo.length * 0.5);
  });

  it("never enlarges a small image", async () => {
    const small = await noisy(300, 200).jpeg({ quality: 90 }).toBuffer();
    const meta = await sharp((await compressProductImage(small, "jpg")).contents).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(300);
  });

  it("applies the phone orientation and strips private metadata", async () => {
    const rotated = await noisy(300, 100).jpeg().withExif({ IFD0: { Copyright: "secret" } }).withMetadata({ orientation: 6 }).toBuffer();
    const result = await compressProductImage(rotated, "jpg");
    const meta = await sharp(result.contents).metadata();
    expect([meta.width, meta.height]).toEqual([100, 300]);
    expect(meta.exif).toBeUndefined();
  });

  it("turns a transparent PNG into a JPEG on a white background", async () => {
    const png = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const result = await compressProductImage(png, "png");
    const { data } = await sharp(result.contents).raw().toBuffer({ resolveWithObject: true });
    expect(result.extension).toBe("jpg");
    expect(result.compressed).toBe(true);
    expect([data[0], data[1], data[2]].every((value) => value! >= 250)).toBe(true);
  });

  it("converts WebP to JPEG so WhatsApp always receives a photo", async () => {
    const webp = await noisy(800, 600).webp().toBuffer();
    const result = await compressProductImage(webp, "webp");
    expect(result.extension).toBe("jpg");
    expect((await sharp(result.contents).metadata()).format).toBe("jpeg");
  });

  it("keeps an already tiny JPEG as it is instead of making it bigger", async () => {
    const tiny = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } }).jpeg({ quality: 40 }).toBuffer();
    const result = await compressProductImage(tiny, "jpg");
    expect(result.contents.length).toBeLessThanOrEqual(tiny.length);
    expect(result.extension).toBe("jpg");
  });

  it("keeps the original photo when the file is damaged", async () => {
    const damaged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("this is not a real image")]);
    const result = await compressProductImage(damaged, "jpg");
    expect(result).toEqual({ contents: damaged, extension: "jpg", compressed: false });
    expect(console.warn).toHaveBeenCalled();
  });

  it("keeps the original photo when the image library cannot be loaded", async () => {
    const png = await noisy(200, 200).png().toBuffer();
    const missing: SharpLoader = () => Promise.reject(new Error("Could not load the sharp module"));
    const result = await compressProductImage(png, "png", missing);
    expect(result).toEqual({ contents: png, extension: "png", compressed: false });
  });

  it("recovers on the next photo after a failure", async () => {
    const photo = await noisy(1600, 1200).jpeg({ quality: 95 }).toBuffer();
    const missing: SharpLoader = () => Promise.reject(new Error("boom"));
    expect((await compressProductImage(photo, "jpg", missing)).compressed).toBe(false);
    expect((await compressProductImage(photo, "jpg")).compressed).toBe(true);
  });

  it("refuses to decode a decompression bomb and keeps the original", async () => {
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: "#ff0000" } }).png({ compressionLevel: 9 }).toBuffer();
    const result = await compressProductImage(bomb, "png");
    expect(result.compressed).toBe(false);
    expect(result.contents).toBe(bomb);
  }, 60_000);

  it("handles several photos at the same time without mixing them up", async () => {
    const [a, b] = await Promise.all([noisy(1500, 1000).jpeg({ quality: 95 }).toBuffer(), noisy(1000, 1500).jpeg({ quality: 95 }).toBuffer()]);
    const [ra, rb] = await Promise.all([compressProductImage(a, "jpg"), compressProductImage(b, "jpg")]);
    const [ma, mb] = await Promise.all([sharp(ra.contents).metadata(), sharp(rb.contents).metadata()]);
    expect(ma.width! > ma.height!).toBe(true);
    expect(mb.height! > mb.width!).toBe(true);
  });

  it("falls back to the original photo when the sharp package itself is missing (default loader)", async () => {
    vi.resetModules();
    vi.doMock("sharp", () => {
      throw new Error("Cannot find module 'sharp'");
    });
    try {
      const { compressProductImage: compressWithoutSharp } = await import("./image-compression.js");
      const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1000, 7)]);
      await expect(compressWithoutSharp(photo, "jpg")).resolves.toEqual({ contents: photo, extension: "jpg", compressed: false });
    } finally {
      vi.doUnmock("sharp");
      vi.resetModules();
    }
  });
});
