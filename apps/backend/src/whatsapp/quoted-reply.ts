/**
 * Message auquel le client répond directement (« swipe to reply »), le cas échéant. WhatsApp place cette
 * information dans contextInfo.stanzaId, quel que soit le type du message qui répond (texte, photo, document).
 */
export function extractQuotedMessageId(unwrapped: Record<string, any>): string | undefined {
  const contextInfo =
    unwrapped.extendedTextMessage?.contextInfo ??
    unwrapped.imageMessage?.contextInfo ??
    unwrapped.documentMessage?.contextInfo;
  const stanzaId = contextInfo?.stanzaId;
  return typeof stanzaId === "string" && stanzaId.trim() ? stanzaId : undefined;
}
