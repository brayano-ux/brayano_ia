import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertAcceptableImageUrl, detectImageType, loadImageForSending } from "./public-image.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;

describe("adresse d'image de l'agent (à l'enregistrement)", () => {
  it("refuse les adresses internes, les schémas dangereux et les formats non autorisés", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/x.png", "http://localhost/x.png", "http://10.0.0.5:8080/admin",
      "http://[::1]/x.png", "http://[64:ff9b::7f00:1]/x.png", "http://x.internal/a.png", "file:///etc/passwd", "ftp://x.com/a.png",
      "blob:https://x.com/abc", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:text/html;base64,PGgxPng8L2gxPg==", "javascript:alert(1)",
    ]) {
      expect(() => assertAcceptableImageUrl(url), url).toThrow();
    }
  });

  it("accepte une adresse publique et une image PNG/JPEG/WebP intégrée", () => {
    expect(() => assertAcceptableImageUrl("https://exemple.cm/logo.png")).not.toThrow();
    expect(() => assertAcceptableImageUrl(PNG_DATA_URL)).not.toThrow();
    expect(() => assertAcceptableImageUrl("")).not.toThrow();
  });
});

describe("chargement d'une image à envoyer", () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/ok.png") { res.setHeader("content-type", "image/png"); res.end(PNG); }
      else if (req.url === "/faux.png") { res.setHeader("content-type", "image/png"); res.end("<html><script>alert(1)</script></html>"); }
      else if (req.url === "/page") { res.setHeader("content-type", "text/html"); res.end("<p>pas une image</p>"); }
      else { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("ne contacte jamais une adresse interne (même si un serveur local répond)", async () => {
    await expect(loadImageForSending(`${base}/ok.png`)).rejects.toThrow(/pas accessible|port/);
    await expect(loadImageForSending("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/pas accessible/);
    await expect(loadImageForSending("blob:https://x.com/abc")).rejects.toThrow();
  });

  it("décode une image intégrée et vérifie son vrai format", async () => {
    const image = await loadImageForSending(PNG_DATA_URL);
    expect(image.mimeType).toBe("image/png");
    expect(image.data.equals(PNG)).toBe(true);
    await expect(loadImageForSending(`data:image/png;base64,${Buffer.from("<svg/>").toString("base64")}`)).rejects.toThrow(/JPEG, PNG ou WebP/);
  });

  it("reconnaît le vrai type d'une image à ses premiers octets", () => {
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WEBP"))).toBe("image/webp");
    expect(detectImageType(Buffer.from("<html>"))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});
