import { describe, expect, it } from "vitest";
import { startedFromAdClick } from "./ad-referral.js";

describe("startedFromAdClick", () => {
  it("reconnaît un message ouvert depuis une publicité Cliquer pour WhatsApp", () => {
    const unwrapped = {
      extendedTextMessage: {
        text: "Bonjour, je suis intéressé",
        contextInfo: { externalAdReply: { ctwaClid: "AZ-abc123", sourceType: "ad", sourceId: "120210000000000" } },
      },
    };
    expect(startedFromAdClick(unwrapped)).toBe(true);
  });

  it("ne reconnaît pas un message normal", () => {
    expect(startedFromAdClick({ conversation: "Bonjour" })).toBe(false);
    expect(startedFromAdClick({ extendedTextMessage: { text: "Bonjour" } })).toBe(false);
  });

  it("ne reconnaît pas une publicité sans identifiant de clic (ex. simple aperçu de lien)", () => {
    const unwrapped = {
      extendedTextMessage: {
        text: "Regarde ce lien",
        contextInfo: { externalAdReply: { sourceType: "ad", title: "Un titre" } },
      },
    };
    expect(startedFromAdClick(unwrapped)).toBe(false);
  });
});
