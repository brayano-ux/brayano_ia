/**
 * Garde-fou « promesses non tenues ».
 *
 * Le modèle peut écrire « votre rendez-vous est confirmé » (ou « annulé », « commande
 * enregistrée »…) sans renseigner le champ `booking` / `order` : le client croit alors
 * à une action que le serveur n'a jamais faite. On détecte ces promesses en les comparant
 * à l'état réel (base de données). Détection volontairement prudente : mieux vaut rater
 * une promesse que bloquer une réponse légitime.
 */

export type UnbackedClaim = "booking_confirmed" | "booking_cancelled" | "order_recorded" | "order_cancelled";

const BOOKING_CONFIRMED =
  /(?:rendez[\s-]?vous|rdv|r[ée]servation|cr[ée]neau)[^.!?\n]{0,60}?(?:confirmé(?:e|es|s)?(?![\p{L}])|enregistré(?:e|es|s)?(?![\p{L}])|r[ée]servé(?:e|es|s)?(?![\p{L}])|programmé(?:e|es|s)?(?![\p{L}])|reprogrammé(?:e|es|s)?(?![\p{L}])|d[ée]placé(?:e|es|s)?(?![\p{L}])|noté(?:e|es|s)?(?![\p{L}]))|(?:appointment|booking)[^.!?\n]{0,40}?(?:confirmed|booked|scheduled|rescheduled|moved)(?![\p{L}])/giu;
const BOOKING_CANCELLED =
  /(?:rendez[\s-]?vous|rdv|r[ée]servation)[^.!?\n]{0,60}?(?:annulé(?:e|es|s)?(?![\p{L}])|supprimé(?:e|es|s)?(?![\p{L}]))|(?:appointment|booking)[^.!?\n]{0,40}?cancell?ed(?![\p{L}])/giu;
const ORDER_RECORDED =
  /commande[^.!?\n]{0,60}?(?:enregistré(?:e|es|s)?(?![\p{L}])|validé(?:e|es|s)?(?![\p{L}])|confirmé(?:e|es|s)?(?![\p{L}])|noté(?:e|es|s)?(?![\p{L}])|prise en compte)|order[^.!?\n]{0,40}?(?:recorded|placed|confirmed|registered)(?![\p{L}])/giu;
const ORDER_CANCELLED = /commande[^.!?\n]{0,60}?annulé(?:e|es|s)?(?![\p{L}])|order[^.!?\n]{0,40}?cancell?ed(?![\p{L}])/giu;

/** « le rendez-vous n'est pas encore confirmé » ne doit pas compter comme une promesse. */
const NEGATION = /\b(?:pas|jamais|non|ni|not|never|no)\b|n['’]/i;

function claims(pattern: RegExp, text: string): boolean {
  for (const match of text.matchAll(pattern)) {
    if (!NEGATION.test(match[0])) return true;
  }
  return false;
}

export interface ClaimCheckInput {
  reply: string;
  agendaEnabled: boolean;
  ordersEnabled: boolean;
  booking?: { action: string } | null | undefined;
  order?: { action: string } | null | undefined;
  /** Le client a un rendez-vous réservé à venir. */
  hasUpcomingAppointment: boolean;
  /** Le client a une commande non annulée récente. */
  hasRecentOrder: boolean;
  /** Le client a une commande encore « Nouvelle » (annulable). */
  hasOpenNewOrder: boolean;
}

export function findUnbackedClaims(input: ClaimCheckInput): UnbackedClaim[] {
  const found: UnbackedClaim[] = [];
  const { reply } = input;

  if (input.agendaEnabled && !input.booking) {
    if (!input.hasUpcomingAppointment && claims(BOOKING_CONFIRMED, reply)) found.push("booking_confirmed");
    if (input.hasUpcomingAppointment && claims(BOOKING_CANCELLED, reply)) found.push("booking_cancelled");
  }
  if (input.ordersEnabled && !input.order) {
    if (!input.hasRecentOrder && claims(ORDER_RECORDED, reply)) found.push("order_recorded");
    if (input.hasOpenNewOrder && claims(ORDER_CANCELLED, reply)) found.push("order_cancelled");
  }
  return found;
}

const CORRECTIONS: Record<UnbackedClaim, string> = {
  booking_confirmed:
    'Tu as écrit que le rendez-vous était confirmé/réservé alors que "booking" était null : rien n\'a été enregistré. Si le prospect a confirmé un créneau précis de la liste, renseigne "booking" avec {"action":"book","date":"AAAA-MM-JJ","time":"HH:mm"} ; sinon ne dis PAS que c\'est confirmé et demande la date et l\'heure.',
  booking_cancelled:
    'Tu as écrit que le rendez-vous était annulé alors que "booking" était null : rien n\'a été annulé. Si le prospect veut annuler, renseigne "booking" avec {"action":"cancel"} ; sinon ne dis pas que c\'est annulé.',
  order_recorded:
    'Tu as écrit que la commande était enregistrée alors que "order" était null : rien n\'a été enregistré. Si le client a confirmé sa commande, renseigne "order" avec "create" ; sinon ne dis pas qu\'elle est enregistrée et demande ce qui manque.',
  order_cancelled:
    'Tu as écrit que la commande était annulée alors que "order" était null : rien n\'a été annulé. Si le client veut annuler, renseigne "order" avec {"action":"cancel"} ; sinon ne dis pas qu\'elle est annulée.',
};

/** Texte ajouté au prompt pour la nouvelle tentative. */
export function buildClaimCorrection(found: UnbackedClaim[]): string {
  return `CORRECTION IMPORTANTE (ta réponse précédente était incohérente avec les actions réellement demandées) :\n${found.map((claim) => `- ${CORRECTIONS[claim]}`).join("\n")}\nRéponds de nouveau au dernier message du prospect, en respectant ces règles.`;
}

const NOTICES: Record<UnbackedClaim, string> = {
  booking_confirmed:
    "⚠️ Je n'ai pas pu enregistrer ce rendez-vous. Pouvez-vous me redonner la date et l'heure souhaitées ? / I couldn't record that appointment. Could you tell me the date and time again?",
  booking_cancelled:
    "⚠️ Ce rendez-vous n'a pas été annulé. Souhaitez-vous que je l'annule ? / That appointment has not been cancelled. Would you like me to cancel it?",
  order_recorded:
    "⚠️ Je n'ai pas pu enregistrer cette commande. Pouvez-vous me la confirmer à nouveau ? / I couldn't record that order. Could you confirm it again?",
  order_cancelled:
    "⚠️ Cette commande n'a pas été annulée. Souhaitez-vous que je l'annule ? / That order has not been cancelled. Would you like me to cancel it?",
};

/** Dernier recours si la nouvelle tentative contient encore une promesse non tenue : on le dit honnêtement. */
export function describeUnbackedClaims(found: UnbackedClaim[]): string {
  return found.map((claim) => NOTICES[claim]).join("\n");
}
