import { describe, expect, it } from "vitest";
import { BotSentIds, extractHumanOutgoing } from "./outgoing-detection.js";

const NOW = Date.parse("2026-10-09T10:00:00Z");
const ts = (offsetSeconds = 0) => Math.floor(NOW / 1000) + offsetSeconds;
const msg = (over: Record<string, unknown> = {}) => ({
  key: { id: "MSG1", fromMe: true, remoteJid: "237600000000@s.whatsapp.net" },
  message: { conversation: "Bonjour, je prends le relais" },
  messageTimestamp: ts(),
  ...over,
});

describe("extractHumanOutgoing", () => {
  const bot = new BotSentIds();

  it("detects a human message typed on the phone", () => {
    expect(extractHumanOutgoing(msg(), bot, NOW)).toEqual({
      externalId: "MSG1",
      toJid: "237600000000@s.whatsapp.net",
      text: "Bonjour, je prends le relais",
      timestamp: new Date(NOW),
    });
  });

  it("ignores the messages sent by the application itself", () => {
    const sent = new BotSentIds();
    sent.add("MSG1");
    expect(extractHumanOutgoing(msg(), sent, NOW)).toBeNull();
  });

  it("ignores incoming messages", () => {
    expect(extractHumanOutgoing(msg({ key: { id: "M", fromMe: false, remoteJid: "237@s.whatsapp.net" } }), bot, NOW)).toBeNull();
  });

  it("prefers the phone-number address when WhatsApp also gives a LID", () => {
    const result = extractHumanOutgoing(msg({ key: { id: "M2", fromMe: true, remoteJid: "1234@lid", remoteJidAlt: "237600000000@s.whatsapp.net" } }), bot, NOW);
    expect(result?.toJid).toBe("237600000000@s.whatsapp.net");
  });

  it("ignores groups, statuses and channels", () => {
    for (const remoteJid of ["123-456@g.us", "status@broadcast", "999@newsletter"]) {
      expect(extractHumanOutgoing(msg({ key: { id: "M3", fromMe: true, remoteJid } }), bot, NOW)).toBeNull();
    }
  });

  it("ignores reactions, deletions and encryption keys", () => {
    expect(extractHumanOutgoing(msg({ message: { reactionMessage: { text: "👍" } } }), bot, NOW)).toBeNull();
    expect(extractHumanOutgoing(msg({ message: { protocolMessage: { type: 0 } } }), bot, NOW)).toBeNull();
    expect(extractHumanOutgoing(msg({ message: { senderKeyDistributionMessage: {} } }), bot, NOW)).toBeNull();
  });

  it("counts media sent from the phone as a human reply, with its caption when present", () => {
    expect(extractHumanOutgoing(msg({ message: { imageMessage: { caption: "Voici le produit" } } }), bot, NOW)?.text).toBe("Voici le produit");
    expect(extractHumanOutgoing(msg({ message: { audioMessage: {} } }), bot, NOW)?.text).toBeNull();
  });

  it("unwraps ephemeral messages", () => {
    const result = extractHumanOutgoing(msg({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: "salut" } } } } }), bot, NOW);
    expect(result?.text).toBe("salut");
  });

  it("ignores old history replayed after a reconnection", () => {
    expect(extractHumanOutgoing(msg({ messageTimestamp: ts(-3600) }), bot, NOW)).toBeNull();
  });
});

describe("BotSentIds", () => {
  it("forgets the oldest ids once the limit is reached", () => {
    const ids = new BotSentIds();
    for (let i = 0; i < 2100; i += 1) ids.add(`id-${i}`);
    expect(ids.has("id-0")).toBe(false);
    expect(ids.has("id-2099")).toBe(true);
  });
});
