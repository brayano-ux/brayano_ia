import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, safeEqualText, verifyPassword } from "./password.js";

describe("mots de passe", () => {
  it("stocke une empreinte salée : deux hachages du même mot de passe sont différents", async () => {
    const [a, b] = await Promise.all([hashPassword("MonMotDePasse123"), hashPassword("MonMotDePasse123")]);
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("MonMotDePasse123");
  });

  it("vérifie le bon mot de passe et refuse les autres", async () => {
    const hash = await hashPassword("MonMotDePasse123");
    expect(await verifyPassword("MonMotDePasse123", hash)).toBe(true);
    expect(await verifyPassword("monmotdepasse123", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("accepte encore les anciennes empreintes SHA-256 et demande de les remplacer", async () => {
    const legacy = createHash("sha256").update("ancien-mot-de-passe").digest("hex");
    expect(await verifyPassword("ancien-mot-de-passe", legacy)).toBe(true);
    expect(await verifyPassword("autre", legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword("x"))).toBe(false);
    expect(needsRehash(undefined)).toBe(false);
  });

  it("refuse une empreinte absente, mal formée ou aux paramètres abusifs", async () => {
    expect(await verifyPassword("x", undefined)).toBe(false);
    expect(await verifyPassword("x", "x")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$zz")).toBe(false);
    expect(await verifyPassword("x", `scrypt$${2 ** 30}$8$1$${"00".repeat(16)}$${"00".repeat(32)}`)).toBe(false);
    expect(await verifyPassword("x", `scrypt$0$8$1$${"00".repeat(16)}$${"00".repeat(32)}`)).toBe(false);
  });

  it("compare des textes à temps constant", () => {
    expect(safeEqualText("abc", "abc")).toBe(true);
    expect(safeEqualText("abc", "abd")).toBe(false);
    expect(safeEqualText("abc", "abcd")).toBe(false);
  });
});
