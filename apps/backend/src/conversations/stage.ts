/**
 * Étiquettes de suivi d'un client : Nouveau → Intéressé → A commandé, et « À rappeler » (une personne doit reprendre).
 * L'assistant les fait avancer tout seul ; le propriétaire peut les fixer à la main (stageLocked).
 */
export type ConversationStageValue = "NEW" | "INTERESTED" | "ORDERED" | "CALLBACK";

export const STAGE_LABELS: Record<ConversationStageValue, string> = {
  NEW: "Nouveau",
  INTERESTED: "Intéressé",
  ORDERED: "A commandé",
  CALLBACK: "À rappeler",
};

/** Intentions qui montrent un vrai intérêt commercial (pas une simple salutation ou un remerciement). */
const INTEREST_INTENTS = new Set([
  "demande_prix",
  "demande_disponibilite",
  "demande_commande",
  "achat",
  "demande_livraison",
  "demande_paiement",
  "demande_inscription",
]);

export interface StageSignals {
  intent?: string | null;
  qualificationStatus?: "NOT_QUALIFIED" | "QUALIFYING" | "QUALIFIED" | null;
  leadScore?: number | null;
  /** Une commande ou un rendez-vous vient d'être enregistré dans cette réponse. */
  converted?: boolean;
  /** L'IA passe la main à une personne. */
  handoff?: boolean;
}

export function computeAutoStage(current: ConversationStageValue, locked: boolean, signals: StageSignals): ConversationStageValue {
  if (locked) return current;
  if (signals.converted) return "ORDERED";
  if (current === "ORDERED") return "ORDERED";
  if (signals.handoff) return "CALLBACK";
  if (current === "CALLBACK") return "CALLBACK";
  const interested =
    (signals.intent ? INTEREST_INTENTS.has(signals.intent) : false) ||
    signals.qualificationStatus === "QUALIFIED" ||
    signals.qualificationStatus === "QUALIFYING" ||
    (signals.leadScore ?? 0) >= 40;
  return interested ? "INTERESTED" : current;
}

/** Ordre d'affichage dans la boîte de réception : ce qui attend une personne d'abord. */
export function stagePriority(stage: ConversationStageValue, status: string): number {
  if (status === "HUMAN_HANDOFF" || stage === "CALLBACK") return 0;
  if (stage === "INTERESTED") return 1;
  if (stage === "NEW") return 2;
  return 3;
}
