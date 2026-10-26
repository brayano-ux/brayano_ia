/**
 * Démarrage via une publicité Facebook/Instagram « Cliquer pour WhatsApp ».
 * WhatsApp attache cette information uniquement au tout premier message d'une conversation ouverte
 * en cliquant sur le bouton WhatsApp d'une telle publicité (identifiant ctwaClid).
 */
export function startedFromAdClick(unwrapped: Record<string, any>): boolean {
  return Boolean(unwrapped.extendedTextMessage?.contextInfo?.externalAdReply?.ctwaClid);
}
