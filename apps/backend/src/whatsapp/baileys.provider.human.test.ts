import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ socket: null as any, ids: 0 }));
vi.mock("@whiskeysockets/baileys", () => ({
  default: vi.fn(() => mocks.socket),
  DisconnectReason: { loggedOut: 401 },
  downloadMediaMessage: vi.fn(),
  fetchLatestBaileysVersion: vi.fn(async () => ({ version: [2, 0, 0] })),
  useMultiFileAuthState: vi.fn(async () => ({ state: {}, saveCreds: vi.fn() })),
  generateMessageID: vi.fn(() => `BOT-${++mocks.ids}`),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn() } }));

import { BaileysWhatsAppProvider } from "./baileys.provider.js";

const JID = "237600000000@s.whatsapp.net";
const nowSeconds = () => Math.floor(Date.now() / 1000);

function createSocket() {
  const ev = new EventEmitter();
  return { ev: { on: ev.on.bind(ev), emit: ev.emit.bind(ev) }, sendMessage: vi.fn(async () => ({})), requestPairingCode: vi.fn(), logout: vi.fn() };
}

describe("BaileysWhatsAppProvider : réponse humaine depuis le téléphone", () => {
  let provider: BaileysWhatsAppProvider;
  const human = vi.fn();
  const incoming = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.ids = 0;
    mocks.socket = createSocket();
    provider = new BaileysWhatsAppProvider("/tmp/wa-test-auth");
    provider.onHumanMessage(human);
    provider.onMessage(incoming);
    await provider.connect();
  });

  const upsert = (msg: unknown) => mocks.socket.ev.emit("messages.upsert", { messages: [msg], type: "notify" });

  it("sends the AI messages with an identifier it remembers", async () => {
    await provider.sendMessage(JID, "Bonjour");
    expect(mocks.socket.sendMessage).toHaveBeenCalledWith(JID, { text: "Bonjour" }, { messageId: "BOT-1" });
  });

  it("does not mistake the echo of its own message for a human reply", async () => {
    await provider.sendMessage(JID, "Bonjour");
    upsert({ key: { id: "BOT-1", fromMe: true, remoteJid: JID }, message: { conversation: "Bonjour" }, messageTimestamp: nowSeconds() });
    await new Promise((r) => setTimeout(r, 20));
    expect(human).not.toHaveBeenCalled();
  });

  it("does not mistake an image sent by the application for a human reply", async () => {
    await provider.sendImage(JID, "https://example.com/p.jpg", "Photo");
    expect(mocks.socket.sendMessage).toHaveBeenCalledWith(JID, expect.anything(), { messageId: "BOT-1" });
    upsert({ key: { id: "BOT-1", fromMe: true, remoteJid: JID }, message: { imageMessage: { caption: "Photo" } }, messageTimestamp: nowSeconds() });
    await new Promise((r) => setTimeout(r, 20));
    expect(human).not.toHaveBeenCalled();
  });

  it("reports a message typed by a person on the phone", async () => {
    upsert({ key: { id: "PHONE-9", fromMe: true, remoteJid: JID }, message: { conversation: "Je prends la main" }, messageTimestamp: nowSeconds() });
    await new Promise((r) => setTimeout(r, 20));
    expect(human).toHaveBeenCalledTimes(1);
    expect(human).toHaveBeenCalledWith(expect.objectContaining({ externalId: "PHONE-9", toJid: JID, text: "Je prends la main" }));
    expect(incoming).not.toHaveBeenCalled();
  });

  it("still delivers a prospect's message as an incoming message", async () => {
    upsert({ key: { id: "IN-1", fromMe: false, remoteJid: JID }, message: { conversation: "Bonjour" }, messageTimestamp: nowSeconds() });
    await new Promise((r) => setTimeout(r, 20));
    expect(incoming).toHaveBeenCalledWith(expect.objectContaining({ externalId: "IN-1", fromJid: JID, text: "Bonjour" }));
    expect(human).not.toHaveBeenCalled();
  });
});
