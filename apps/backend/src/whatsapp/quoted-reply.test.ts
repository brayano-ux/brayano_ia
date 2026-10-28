import { describe, expect, it } from "vitest";
import { extractQuotedMessageId } from "./quoted-reply.js";

describe("extractQuotedMessageId", () => {
  it("lit l'identifiant du message cité dans une réponse texte", () => {
    const unwrapped = { extendedTextMessage: { text: "C'est combien ?", contextInfo: { stanzaId: "ABC123" } } };
    expect(extractQuotedMessageId(unwrapped)).toBe("ABC123");
  });

  it("lit l'identifiant du message cité dans une réponse photo", () => {
    const unwrapped = { imageMessage: { contextInfo: { stanzaId: "XYZ789" } } };
    expect(extractQuotedMessageId(unwrapped)).toBe("XYZ789");
  });

  it("renvoie undefined sans réponse", () => {
    expect(extractQuotedMessageId({ conversation: "Bonjour" })).toBeUndefined();
    expect(extractQuotedMessageId({ extendedTextMessage: { text: "Salut", contextInfo: {} } })).toBeUndefined();
    expect(extractQuotedMessageId({})).toBeUndefined();
  });
});
