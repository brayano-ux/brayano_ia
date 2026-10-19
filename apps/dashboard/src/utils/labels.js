/**
 * Libellés lisibles pour le propriétaire : étiquettes de suivi, intentions détectées, actions de l'assistant.
 * Aucun jargon technique ne doit apparaître à l'écran.
 */

export const STAGES = ["NEW", "INTERESTED", "ORDERED", "CALLBACK"];

export const STAGE_LABELS = {
  NEW: "Nouveau",
  INTERESTED: "Intéressé",
  ORDERED: "A commandé",
  CALLBACK: "À rappeler",
};

/** Couleur du badge (classes `.status-chip.*` de overview.css + `.stage-*` de inbox.css). */
export const STAGE_TONES = {
  NEW: "neutral",
  INTERESTED: "info",
  ORDERED: "success",
  CALLBACK: "warning",
};

export const INTENT_LABELS = {
  salutation: "Salutation",
  demande_information: "Demande d'information",
  demande_prix: "Demande de prix",
  demande_disponibilite: "Demande de disponibilité",
  demande_localisation: "Demande d'adresse",
  demande_commande: "Veut commander",
  demande_inscription: "Veut s'inscrire",
  demande_livraison: "Question sur la livraison",
  demande_paiement: "Question sur le paiement",
  achat: "Prêt à acheter",
  demande_contact_humain: "Veut parler à une personne",
  reclamation: "Réclamation",
  remerciement: "Remerciement",
  hors_sujet: "Hors sujet",
  autre: "Autre",
  erreur_traitement: "Erreur technique",
};

const ACTION_RESULTS = {
  booking: {
    book: "Rendez-vous réservé",
    reschedule: "Rendez-vous déplacé",
    cancel: "Rendez-vous annulé",
    already_booked: "Rendez-vous déjà enregistré",
    unavailable: "Créneau indisponible : d'autres horaires ont été proposés",
    nothing_to_cancel: "Aucun rendez-vous à annuler",
    invalid: "Date ou heure à préciser",
  },
  order: {
    create: "Commande enregistrée",
    already_created: "Commande déjà enregistrée",
    cancel: "Commande annulée",
    cancel_too_late: "Commande déjà confirmée : le propriétaire a été prévenu",
    nothing_to_cancel: "Aucune commande à annuler",
    missing: "Information manquante pour la commande (adresse ou nom)",
    unknown_product: "Produit absent du catalogue",
  },
};

/**
 * « Pourquoi cette réponse ? » : transforme ce que le serveur a noté sur un message de l'assistant
 * en lignes simples. Renvoie [] pour un message sans journal (anciens messages).
 */
export function describeAiMeta(meta) {
  if (!meta || typeof meta !== "object") return [];
  const lines = [];

  if (meta.kind === "welcome") return ["Message d'accueil de votre entreprise, envoyé au premier contact."];
  if (meta.kind === "opt_out") return ["Le client a écrit STOP : il ne recevra plus de relances ni de messages groupés."];
  if (meta.kind === "follow_up") return [`Relance automatique n°${meta.number || 1} : le client n'avait pas répondu.`];
  if (meta.kind === "broadcast") return ["Message groupé envoyé depuis la page « Messages groupés »."];

  if (meta.intent) {
    const confidence = typeof meta.confidence === "number" ? ` (confiance ${Math.round(meta.confidence * 100)} %)` : "";
    lines.push(`Ce que l'assistant a compris : ${INTENT_LABELS[meta.intent] || meta.intent}${confidence}.`);
  }
  for (const action of Array.isArray(meta.actions) ? meta.actions : []) {
    const label = ACTION_RESULTS[action.type]?.[action.result];
    if (label) lines.push(`Action : ${label}.`);
  }
  if (meta.photosSent) {
    const names = Array.isArray(meta.productNames) && meta.productNames.length ? ` (${meta.productNames.join(", ")})` : "";
    lines.push(`Photo${meta.photosSent > 1 ? "s" : ""} envoyée${meta.photosSent > 1 ? "s" : ""}${names}.`);
  }
  if (meta.welcomeSent) lines.push("Le message d'accueil a été envoyé juste avant.");
  if (meta.closedHours) lines.push("Votre entreprise était fermée : l'assistant l'a pris en compte.");
  if (meta.correctionsUsed) lines.push(`${meta.correctionsUsed} de vos corrections appliquée${meta.correctionsUsed > 1 ? "s" : ""}.`);
  if (meta.examplesUsed) lines.push(`Inspiré de ${meta.examplesUsed} conversation${meta.examplesUsed > 1 ? "s" : ""} passée${meta.examplesUsed > 1 ? "s" : ""} qui ${meta.examplesUsed > 1 ? "ont" : "a"} abouti.`);
  if (meta.claimRetried) lines.push("L'assistant avait annoncé une action qu'il n'avait pas faite : la réponse a été corrigée.");
  if (Array.isArray(meta.claimsUnresolved) && meta.claimsUnresolved.length) lines.push("Un avertissement a été ajouté pour le client (action non réalisée).");
  if (meta.needsHuman) lines.push("L'assistant a passé la main : vous avez reçu un email.");
  if (meta.answeringFile) lines.push("Réponse à un fichier envoyé par le client (jamais de confirmation de paiement).");
  return lines;
}

/** Message de l'historique → texte court pour l'aperçu de la liste. */
export function previewOf(message) {
  if (!message) return "Aucun message";
  if (message.type === "IMAGE") return "📷 Photo";
  if (message.type === "DOCUMENT") return "📎 Document";
  return message.content || "Aucun message";
}
