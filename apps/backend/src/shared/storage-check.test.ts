import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkProductImagesOnSameDisk, warnIfProductImagesAreEphemeral } from "./storage-check.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "storage-check-"));
afterEach(() => vi.restoreAllMocks());

describe("checkProductImagesOnSameDisk", () => {
  it("is true when both folders live on the same file system", () => {
    expect(checkProductImagesOnSameDisk(root, path.join(root, "product-images"))).toBe(true);
  });

  it("is false when the photos are on another file system than the sessions", () => {
    const devices: Record<string, number> = { "/var/data/wa-session": 100, "/data/product-images": 200 };
    const stat = (target: string) => ({ dev: devices[target] ?? -1 });
    expect(checkProductImagesOnSameDisk("/var/data/wa-session", path.join(root, "x"), (t) => stat(t === path.join(root, "x") ? "/data/product-images" : t))).toBe(false);
  });

  it("is null when the comparison is impossible", () => {
    expect(checkProductImagesOnSameDisk(path.join(root, "absent"), path.join(root, "p"))).toBeNull();
  });
});

describe("warnIfProductImagesAreEphemeral", () => {
  it("says clearly when photos would be lost at the next deployment", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // un dossier de sessions sur /dev/shm (autre système de fichiers) et des photos dans le dossier temporaire
    const shm = "/dev/shm";
    if (fs.existsSync(shm) && fs.statSync(shm).dev !== fs.statSync(root).dev) {
      warnIfProductImagesAreEphemeral(shm, path.join(root, "photos"));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("perdues au prochain redéploiement"));
    }
  });

  it("stays silent when everything is on the same disk", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnIfProductImagesAreEphemeral(root, path.join(root, "product-images"));
    expect(warn).not.toHaveBeenCalled();
  });
});
