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

import { BaileysWhatsAppProvider } from "./baileys.provider.js";

function createSocket() {
  const ev = new EventEmitter();
  return {
    ev: { on: ev.on.bind(ev), emit: ev.emit.bind(ev) },
    user: { id: "237600000000:12@s.whatsapp.net" },
    sendMessage: vi.fn(),
    requestPairingCode: vi.fn(),
    logout: vi.fn(async () => undefined),
  };
}

describe("raison des déconnexions transmise au moniteur", () => {
  const updates: Array<{ status: string; reason?: string; phoneNumber?: string; detail?: string }> = [];
  let provider: BaileysWhatsAppProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    updates.length = 0;
    mocks.socket = createSocket();
    provider = new BaileysWhatsAppProvider("/tmp/wa-test-auth-connection");
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

  it("reports a successful connection with the phone number and no reason", async () => {
    mocks.socket.ev.emit("connection.update", { connection: "open" });
    expect(updates.at(-1)).toEqual({ status: "CONNECTED", phoneNumber: "237600000000" });
  });
});
