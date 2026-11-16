import { generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createGoogleSignupToken, readGoogleSignupToken, resetGoogleKeysForTests, verifyGoogleIdToken } from "./google.js";

const CLIENT_ID = "123-abc.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 10, 16, 10, 0, 0);

function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...(publicKey.export({ format: "jwk" }) as object), kid, alg: "RS256", use: "sig" } };
}
const google = keyPair("google-key-1");
const attacker = keyPair("google-key-1");

function sign(payload: Record<string, unknown>, options: { key?: KeyObject; kid?: string; alg?: string } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: options.alg ?? "RS256", kid: options.kid ?? google.kid, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${signer.sign(options.key ?? google.privateKey).toString("base64url")}`;
}
const validPayload = (overrides: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1098765", email: "Awa@Gmail.com", email_verified: true, name: "Awa Ngono",
  iat: NOW / 1000 - 10, exp: NOW / 1000 + 3600, ...overrides,
});
let fetchCount = 0;
const options = { now: () => NOW, fetchKeys: async () => { fetchCount += 1; return { keys: [google.jwk], maxAgeMs: 3_600_000 }; } };

describe("verifyGoogleIdToken", () => {
  beforeEach(() => { resetGoogleKeysForTests(); fetchCount = 0; });

  it("accepte un jeton signé par Google et renvoie l'email en minuscules", async () => {
    await expect(verifyGoogleIdToken(sign(validPayload()), CLIENT_ID, options)).resolves.toEqual({ sub: "1098765", email: "awa@gmail.com", name: "Awa Ngono" });
  });

  it("garde les clés Google en mémoire entre deux connexions", async () => {
    await verifyGoogleIdToken(sign(validPayload()), CLIENT_ID, options);
    await verifyGoogleIdToken(sign(validPayload()), CLIENT_ID, options);
    expect(fetchCount).toBe(1);
  });

  it("refuse une signature qui ne vient pas de Google", async () => {
    await expect(verifyGoogleIdToken(sign(validPayload(), { key: attacker.privateKey }), CLIENT_ID, options)).rejects.toThrow("signature invalide");
  });

  it("refuse un contenu modifié après signature", async () => {
    const [header, , signature] = sign(validPayload()).split(".");
    const forged = Buffer.from(JSON.stringify(validPayload({ email: "patron@boutique.cm" }))).toString("base64url");
    await expect(verifyGoogleIdToken(`${header}.${forged}.${signature}`, CLIENT_ID, options)).rejects.toThrow("signature invalide");
  });

  it.each([
    ["destiné à une autre application", { aud: "autre-appli.apps.googleusercontent.com" }, "autre application"],
    ["expiré", { exp: NOW / 1000 - 3600 }, "expiré"],
    ["d'un autre émetteur", { iss: "https://evil.example.com" }, "émetteur"],
    ["avec un email non vérifié", { email_verified: false }, "pas vérifiée"],
    ["sans email", { email: undefined }, "incomplet"],
  ])("refuse un jeton %s", async (_label, overrides, message) => {
    await expect(verifyGoogleIdToken(sign(validPayload(overrides)), CLIENT_ID, options)).rejects.toThrow(message);
  });

  it("refuse un autre algorithme que RS256 et une clé inconnue", async () => {
    await expect(verifyGoogleIdToken(sign(validPayload(), { alg: "HS256" }), CLIENT_ID, options)).rejects.toThrow("algorithme");
    await expect(verifyGoogleIdToken(sign(validPayload(), { kid: "cle-inconnue" }), CLIENT_ID, options)).rejects.toThrow("clé de signature inconnue");
  });

  it("refuse un jeton mal formé", async () => {
    await expect(verifyGoogleIdToken("pas.un-jeton", CLIENT_ID, options)).rejects.toThrow("mal formé");
  });
});

describe("jeton d'inscription Google", () => {
  const identity = { email: "awa@gmail.com", name: "Awa", sub: "1098765" };

  it("se relit avec le même secret pendant 30 minutes", () => {
    const token = createGoogleSignupToken(identity, "secret-serveur", NOW);
    expect(readGoogleSignupToken(token, "secret-serveur", NOW + 29 * 60_000)).toEqual(identity);
    expect(readGoogleSignupToken(token, "secret-serveur", NOW + 31 * 60_000)).toBeNull();
  });

  it("ne peut pas être fabriqué ni modifié sans le secret du serveur", () => {
    const token = createGoogleSignupToken(identity, "secret-serveur", NOW);
    expect(readGoogleSignupToken(token, "autre-secret", NOW)).toBeNull();
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...identity, email: "patron@boutique.cm", exp: NOW + 60_000 })).toString("base64url");
    expect(readGoogleSignupToken(`${forged}.${signature}`, "secret-serveur", NOW)).toBeNull();
    expect(readGoogleSignupToken("n'importe quoi", "secret-serveur", NOW)).toBeNull();
  });
});
