/**
 * Un client qui écrit « STOP » (ou « ne m'écrivez plus ») ne doit plus recevoir de relances ni de messages groupés.
 * Détection volontairement stricte : un message qui contient une vraie demande n'est jamais pris pour un désabonnement.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXACT = new Set(["stop", "arret", "arretez", "stop svp", "stop merci", "unsubscribe", "desabonner", "desabonnez moi", "desabonnez-moi", "stop promo", "stop sms"]);

const PHRASES = [
  /\bne\s+(?:m'?|me\s+)?(?:ecrivez|contactez|envoyez|derangez)\s+plus\b/,
  /\b(?:arretez|cessez)\s+(?:de\s+)?(?:m'?ecrire|me\s+(?:ecrire|contacter|envoyer|deranger)|les\s+messages)\b/,
  /\bne\s+plus\s+(?:recevoir|m'?envoyer)\b/,
  /\bdo\s+not\s+(?:contact|message|write\s+to)\s+me\b/,
  /\bstop\s+(?:messaging|texting|contacting|sending)\b/,
  /\bdesabonn(?:er|ez)\b/,
  /\bretirez\s+(?:moi|mon\s+numero)\b/,
  /\bremove\s+me\b/,
];

export function isOptOutRequest(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized || normalized.length > 90) return false;
  if (EXACT.has(normalized)) return true;
  return PHRASES.some((phrase) => phrase.test(normalized));
}

export const OPT_OUT_CONFIRMATION =
  "Bien noté : vous ne recevrez plus de relances ni de messages promotionnels de notre part. Vous pouvez toujours nous écrire si vous avez une question. / Noted: you will no longer receive follow-ups or promotional messages from us. You can still write to us if you have a question.";
