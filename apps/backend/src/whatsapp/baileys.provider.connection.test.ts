import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ socket: null as any }));
vi.mock("@whiskeysockets/baileys", () => ({
  default: vi.fn(() => mocks.socket),
  DisconnectReason: { loggedOut: 401 },
  downloadMediaMessage: vi.fn(),
  fetchLatestBaileysVersion: vi.fn(async () => ({ version: [2, 0, 0] })),
  useMultiFileAuthState: vi.fn(async () => ({ state: {}, saveCreds: vi.fn() })),
  generateMessageID: vi.fn(() => "ID"),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn() } }));

import { BaileysWhatsAppProvider, computeReconnectDelayMs } from "./baileys.provider.js";

function createSocket() {
  const ev = new EventEmitter();
  return {
    ev: { on: ev.on.bind(ev), emit: ev.emit.bind(ev) },
    user: { id: "237600000000:12@s.whatsapp.net" },
    sendMessage: vi.fn(),
    requestPairingCode: vi.fn(),
    logout: vi.fn(async () => undefined),
    end: vi.fn(),
  };
}

describe("raison des déconnexions transmise au moniteur", () => {
  const updates: Array<{ status: string; reason?: string; phoneNumber?: string; detail?: string }> = [];
  let provider: BaileysWhatsAppProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    updates.length = 0;
    mocks.socket = createSocket();
    // Délai de reconnexion à 0 : le vrai backoff (computeReconnectDelayMs) est testé séparément plus bas,
    // et un délai réel ici ferait fuir des reconnexions en arrière-plan d'un test vers le suivant.
    provider = new BaileysWhatsAppProvider("/tmp/wa-test-auth-connection", () => 0);
    provider.onConnectionUpdate((update) => updates.push(update));
    await provider.connect();
  });

  const close = async (statusCode: number) => {
    mocks.socket.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode } } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  it("reports a logout from the phone as logged_out", async () => {
    await close(401);
    expect(updates.find((u) => u.status === "DISCONNECTED")).toMatchObject({ status: "DISCONNECTED", reason: "logged_out" });
  });

  it("reports any other closure as a lost connection that will retry", async () => {
    await close(515);
    expect(updates.find((u) => u.status === "DISCONNECTED")).toMatchObject({ status: "DISCONNECTED", reason: "connection_lost" });
  });

  it("explains the closure with the WhatsApp code", async () => {
    await close(440);
    expect(updates.find((u) => u.status === "DISCONNECTED")).toMatchObject({ reason: "connection_lost", detail: expect.stringContaining("(code 440)") });
    await close(401);
    expect(updates.filter((u) => u.status === "DISCONNECTED").at(-1)).toMatchObject({ reason: "logged_out", detail: expect.stringContaining("(code 401)") });
  });

  it("reports a voluntary disconnect as manual", async () => {
    await provider.disconnect();
    expect(updates.at(-1)).toMatchObject({ status: "DISCONNECTED", reason: "manual" });
  });

  it("force-closes the socket when logout() fails, so it can't keep receiving messages in the background", async () => {
    mocks.socket.logout = vi.fn(async () => {
      throw new Error("réseau indisponible");
    });
    await provider.disconnect();
    expect(mocks.socket.end).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)).toMatchObject({ status: "DISCONNECTED", reason: "manual" });
  });

  it("never throws even when logout() fails", async () => {
    mocks.socket.logout = vi.fn(async () => {
      throw new Error("réseau indisponible");
    });
    await expect(provider.disconnect()).resolves.toBeUndefined();
  });

  it("reports a successful connection with the phone number and no reason", async () => {
    mocks.socket.ev.emit("connection.update", { connection: "open" });
    expect(updates.at(-1)).toEqual({ status: "CONNECTED", phoneNumber: "237600000000" });
  });

  it("reconnects after a lost connection, through the injectable backoff delay (not after a logout)", async () => {
    const baileys = await import("@whiskeysockets/baileys");
    const makeWASocket = baileys.default as unknown as { mock: { calls: unknown[] } };
    const attempts: number[] = [];
    mocks.socket = createSocket();
    const delayed = new BaileysWhatsAppProvider("/tmp/wa-test-auth-connection-2", (attempt) => {
      attempts.push(attempt);
      return 0;
    });
    await delayed.connect();
    const callsBefore = makeWASocket.mock.calls.length;

    mocks.socket.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 515 } } } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(makeWASocket.mock.calls.length).toBe(callsBefore + 1);
    expect(attempts).toEqual([0]);
  });

  it("never reconnects after a logout from the phone", async () => {
    const baileys = await import("@whiskeysockets/baileys");
    const makeWASocket = baileys.default as unknown as { mock: { calls: unknown[] } };
    const callsBefore = makeWASocket.mock.calls.length;
    await close(401);
    expect(makeWASocket.mock.calls.length).toBe(callsBefore);
  });
});

describe("computeReconnectDelayMs", () => {
  it("grows exponentially and caps at one minute", () => {
    expect(computeReconnectDelayMs(0)).toBeGreaterThanOrEqual(2_000);
    expect(computeReconnectDelayMs(0)).toBeLessThan(2_000 * 1.3);
    expect(computeReconnectDelayMs(3)).toBeGreaterThanOrEqual(16_000);
    expect(computeReconnectDelayMs(3)).toBeLessThan(16_000 * 1.3);
    expect(computeReconnectDelayMs(10)).toBeLessThanOrEqual(60_000 * 1.3);
    expect(computeReconnectDelayMs(20)).toBeLessThanOrEqual(60_000 * 1.3);
  });
});
