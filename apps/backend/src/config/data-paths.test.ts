import { describe, expect, it } from "vitest";
import { defaultProductImageDir } from "./data-paths.js";

describe("defaultProductImageDir", () => {
  it("puts the photos next to the WhatsApp sessions, whatever the disk is mounted on", () => {
    expect(defaultProductImageDir("/var/data/wa-session")).toBe("/var/data/product-images");
    expect(defaultProductImageDir("/data/wa-session")).toBe("/data/product-images");
    expect(defaultProductImageDir("/mnt/disque/sessions/wa")).toBe("/mnt/disque/sessions/product-images");
  });

  it("ignores a trailing slash", () => {
    expect(defaultProductImageDir("/var/data/wa-session/")).toBe("/var/data/product-images");
  });

  it("keeps the historical local folder when the sessions are in a relative folder (development)", () => {
    expect(defaultProductImageDir("./wa-session")).toBe("./uploads/products");
    expect(defaultProductImageDir("wa-session")).toBe("./uploads/products");
  });
});
