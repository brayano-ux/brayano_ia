/**
 * Relances automatiques : un client intéressé (il a demandé un prix, une disponibilité…) qui ne répond plus reçoit
 * un rappel poli — au plus `max` fois, jamais la nuit, jamais s'il a écrit STOP.
 */

export interface FollowUpCandidate {
  stage: "NEW" | "INTERESTED" | "ORDERED" | "CALLBACK";
  status: "OPEN" | "HUMAN_HANDOFF" | "CLOSED";
  aiEnabled: boolean;
  followUpCount: number;
  optedOut: boolean;
  lastMessage: { direction: "INBOUND" | "OUTBOUND"; author: "CONTACT" | "AI" | "HUMAN"; createdAt: Date; aiMeta: unknown } | null;
}

export interface FollowUpRules {
  delayHours: number;
  max: number;
}

/** Au-delà, la conversation est trop ancienne : un rappel surprendrait plus qu'il n'aiderait. */
export const FOLLOW_UP_MAX_AGE_DAYS = 7;

const QUIET_INTENTS = new Set(["remerciement", "hors_sujet", "salutation"]);

export function isDueForFollowUp(candidate: FollowUpCandidate, rules: FollowUpRules, now: Date): boolean {
  const { lastMessage } = candidate;
  if (!lastMessage) return false;
  if (candidate.status !== "OPEN" || !candidate.aiEnabled || candidate.optedOut) return false;
  if (candidate.stage !== "INTERESTED") return false;
  if (candidate.followUpCount >= rules.max) return false;
  // On n'écrit que si c'est notre assistant qui a parlé en dernier : le client n'a pas répondu.
  if (lastMessage.direction !== "OUTBOUND" || lastMessage.author !== "AI") return false;

  const meta = (lastMessage.aiMeta ?? {}) as { kind?: string; intent?: string; nextAction?: string };
  if (meta.kind === "welcome" || meta.kind === "opt_out" || meta.kind === "broadcast") return false;
  if (meta.nextAction === "stop" || (meta.intent && QUIET_INTENTS.has(meta.intent))) return false;

  const elapsedMs = now.getTime() - lastMessage.createdAt.getTime();
  return elapsedMs >= rules.delayHours * 3600_000 && elapsedMs <= FOLLOW_UP_MAX_AGE_DAYS * 24 * 3600_000;
}

/** Consigne ajoutée au prompt pour écrire la relance (le reste du prompt est celui de la conversation). */
export function buildFollowUpInstruction(input: { hoursSinceLastMessage: number; followUpNumber: number }): string {
  const hours = Math.max(1, Math.round(input.hoursSinceLastMessage));
  return `
RELANCE AUTOMATIQUE

Le client n'a pas répondu à ton dernier message depuis environ ${hours} h. C'est la relance numéro ${input.followUpNumber}.
Écris UN seul message court (deux phrases au maximum), poli et chaleureux, qui reprend le sujet de la conversation (le produit, le prix ou le service demandé) et propose ton aide pour la suite.
- Ne mets aucune pression, ne promets aucune remise et n'invente aucune information.
- Ne répète pas mot pour mot ton message précédent et ne pose pas plusieurs questions.
- N'effectue aucune action : "booking" et "order" restent null, needsHuman reste false.
- Si le client a dit qu'il n'est pas intéressé, ou si une relance serait déplacée, réponds exactement SKIP dans "reply".
`.trim();
}

export const FOLLOW_UP_SKIP = "SKIP";
