import { describe, expect, it } from "vitest";
import { buildAccountHistoryUpdate, describeCloseCode } from "./disconnect-reasons.js";

describe("describeCloseCode", () => {
  it("explains the WhatsApp close codes in French, keeping the code", () => {
    expect(describeCloseCode(401)).toBe("Déconnecté depuis le téléphone (Appareils liés) ou session fermée par WhatsApp (code 401)");
    expect(describeCloseCode(440)).toContain("un autre serveur utilise le même numéro");
    expect(describeCloseCode(403)).toContain("banni");
    expect(describeCloseCode(500)).toBe("Session corrompue (code 500)");
  });

  it("stays readable for unknown or missing codes", () => {
    expect(describeCloseCode(999)).toBe("Connexion fermée (code 999)");
    expect(describeCloseCode(undefined)).toBe("Connexion fermée, cause inconnue");
  });
});

describe("buildAccountHistoryUpdate", () => {
  const now = new Date("2026-10-10T09:00:00Z");

  it("records the time of a successful connection", () => {
    expect(buildAccountHistoryUpdate({ status: "CONNECTED" }, now)).toEqual({ lastConnectedAt: now });
  });

  it("records the time and the reason of a disconnection", () => {
    expect(buildAccountHistoryUpdate({ status: "DISCONNECTED", reason: "logged_out", detail: "Session ouverte ailleurs (code 440)" }, now)).toEqual({
      lastDisconnectedAt: now,
      lastDisconnectReason: "Session ouverte ailleurs (code 440)",
    });
  });

  it("labels a voluntary disconnection and an unexplained one", () => {
    expect(buildAccountHistoryUpdate({ status: "DISCONNECTED", reason: "manual" }, now).lastDisconnectReason).toBe("Déconnexion volontaire");
    expect(buildAccountHistoryUpdate({ status: "DISCONNECTED" }, now).lastDisconnectReason).toBe("Cause inconnue");
  });

  it("keeps the disconnection cause when the number only waits for a QR code", () => {
    expect(buildAccountHistoryUpdate({ status: "QR_PENDING" }, now)).toEqual({});
  });
});
