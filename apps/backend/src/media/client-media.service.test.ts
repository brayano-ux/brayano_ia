import { describe, expect, it } from "vitest";
import {
  buildClientMediaPath, clientMediaResponseHeaders, createClientMediaToken, resolveStoredExtension, verifyClientMediaToken,
} from "./client-media.service.js";

const ORG = "11111111-1111-1111-1111-111111111111";
const FILE = "22222222-2222-2222-2222-222222222222.jpg";

describe("resolveStoredExtension", () => {
  it("garde les images et les PDF", () => {
    expect(resolveStoredExtension("image/jpeg")).toBe("jpg");
    expect(resolveStoredExtension("image/png")).toBe("png");
    expect(resolveStoredExtension("application/pdf", "facture.PDF")).toBe("pdf");
  });

  it("accepte seulement une liste d'extensions de documents et refuse tout le reste", () => {
    expect(resolveStoredExtension("application/octet-stream", "devis.xlsx")).toBe("xlsx");
    expect(resolveStoredExtension("text/html", "page.html")).toBe("bin");
    expect(resolveStoredExtension("image/svg+xml", "logo.svg")).toBe("bin");
    expect(resolveStoredExtension("application/x-msdownload", "virus.exe")).toBe("bin");
  });
});

describe("liens signés", () => {
  it("valide un jeton récent et refuse un jeton falsifié, expiré ou d'une autre entreprise", () => {
    const now = Date.now();
    const token = createClientMediaToken(ORG, FILE, now);
    expect(verifyClientMediaToken(ORG, FILE, token, now + 1000)).toBe(true);
    expect(verifyClientMediaToken(ORG, FILE, `${token}0`, now + 1000)).toBe(false);
    expect(verifyClientMediaToken("33333333-3333-3333-3333-333333333333", FILE, token, now + 1000)).toBe(false);
    expect(verifyClientMediaToken(ORG, "44444444-4444-4444-4444-444444444444.jpg", token, now + 1000)).toBe(false);
    expect(verifyClientMediaToken(ORG, FILE, token, now + 3 * 3600_000)).toBe(false);
    expect(verifyClientMediaToken(ORG, FILE, undefined, now)).toBe(false);
  });

  it("ne confond pas un jeton de photo client avec un autre usage du même secret", () => {
    expect(buildClientMediaPath(ORG, FILE, 1_000)).toMatch(/^\/media\/client\/1{8}-1{4}-1{4}-1{4}-1{12}\/2{8}-2{4}-2{4}-2{4}-2{12}\.jpg\?t=1000:[0-9a-f]{64}$/);
  });
});

describe("clientMediaResponseHeaders", () => {
  it("affiche les images dans la page", () => {
    expect(clientMediaResponseHeaders("image/png", null, FILE)["Content-Type"]).toBe("image/png");
  });

  it("force le téléchargement des documents", () => {
    const headers = clientMediaResponseHeaders("text/html", 'x"><script>.html', FILE) as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["Content-Disposition"]).toMatch(/^attachment; filename="[^"<>]*"$/);
  });
});
