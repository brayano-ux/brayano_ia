import { env } from "../config/env.js";
import { prisma } from "../database/client.js";
import { notifyOrganizationAdmins, buildQuotaReachedEmail } from "../notifications/owner-notifications.js";
import { PlanLimitError } from "../shared/errors.js";
import { BILLING_PLANS, TRIAL, cheapestPlanWith, getBillingPlan, type BillingPlan, type PlanFeatures } from "./billing-plans.js";

const BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const QUOTA_NOTICE_EVERY_MS = 24 * 60 * 60 * 1000;
/** Aucune fonction réservée, aucun employé : ce qu'obtient une entreprise sans forfait valable quand les forfaits sont appliqués. */
const NO_FEATURES: PlanFeatures = { broadcasts: false, followUps: false, teamMembers: 0 };
/** Quand les forfaits ne sont pas appliqués : tout est ouvert (limité seulement par MAX_TEAM_MEMBERS dans team.service). */
const ALL_FEATURES: PlanFeatures = { broadcasts: true, followUps: true, teamMembers: Number.MAX_SAFE_INTEGER };

/**
 * Les forfaits ne coupent personne tant que BILLING_ENFORCED n'est pas « true » : l'assistant répond comme avant, mais les
 * messages sont déjà comptés pour que les chiffres soient prêts le jour où on les applique.
 */
const state = { enforced: env.BILLING_ENFORCED };
export function isBillingEnforced() {
  return state.enforced;
}
/** Réservé aux tests : force l'application des forfaits (null : revient à la variable d'environnement). */
export function setBillingEnforcedForTests(value: boolean | null) {
  state.enforced = value ?? env.BILLING_ENFORCED;
}

export type DenyReason = "trial_exhausted" | "subscription_expired" | "message_quota_exhausted";

export type AiResponseEntitlement =
  | { allowed: true; source: "trial"; remaining: number }
  | { allowed: true; source: "subscription"; remaining: number; periodStartedAt: Date }
  | { allowed: true; source: "unlimited"; remaining: number }
  | { allowed: false; reason: DenyReason };

function denyOrAllow(reason: DenyReason): AiResponseEntitlement {
  return state.enforced ? { allowed: false, reason } : { allowed: true, source: "unlimited", remaining: Number.POSITIVE_INFINITY };
}

/** Réserve un message de l'assistant (à appeler avant de répondre ; `releaseAiResponse` le rend si la réponse n'est pas partie). */
export async function reserveAiResponse(organizationId: string): Promise<AiResponseEntitlement> {
  const subscription = await prisma.billingSubscription.findUnique({ where: { organizationId } });
  const now = new Date();

  if (subscription) {
    if (subscription.status !== "ACTIVE" || subscription.expiresAt <= now) return denyOrAllow("subscription_expired");

    let current = subscription;
    if (now.getTime() - current.periodStartedAt.getTime() >= BILLING_PERIOD_MS) {
      const elapsedPeriods = Math.floor((now.getTime() - current.periodStartedAt.getTime()) / BILLING_PERIOD_MS);
      const nextPeriodStart = new Date(current.periodStartedAt.getTime() + elapsedPeriods * BILLING_PERIOD_MS);
      await prisma.billingSubscription.updateMany({
        where: { id: current.id, periodStartedAt: current.periodStartedAt },
        data: { periodStartedAt: nextPeriodStart, messagesUsed: 0 },
      });
      current = (await prisma.billingSubscription.findUnique({ where: { organizationId } })) ?? current;
    }

    // Un seul UPDATE conditionnel : jamais de dépassement, même avec 50 messages qui arrivent en même temps.
    const consumed = await prisma.billingSubscription.updateMany({
      where: { id: current.id, status: "ACTIVE", expiresAt: { gt: now }, periodStartedAt: current.periodStartedAt, messagesUsed: { lt: current.messageLimit } },
      data: { messagesUsed: { increment: 1 } },
    });
    if (consumed.count === 0) return denyOrAllow(current.messagesUsed >= current.messageLimit ? "message_quota_exhausted" : "subscription_expired");
    return { allowed: true, source: "subscription", remaining: Math.max(0, current.messageLimit - current.messagesUsed - 1), periodStartedAt: current.periodStartedAt };
  }

  const consumed = await prisma.organization.updateMany({
    where: { id: organizationId, freeAiResponsesRemaining: { gt: 0 } },
    data: { freeAiResponsesRemaining: { decrement: 1 } },
  });
  if (consumed.count === 0) return denyOrAllow("trial_exhausted");
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { freeAiResponsesRemaining: true } });
  return { allowed: true, source: "trial", remaining: organization?.freeAiResponsesRemaining ?? 0 };
}

/** Rend le message réservé quand la réponse n'est finalement pas partie (erreur de l'IA, un humain a repris la main…). */
export async function releaseAiResponse(organizationId: string, reservation: Extract<AiResponseEntitlement, { allowed: true }>) {
  if (reservation.source === "unlimited") return;
  if (reservation.source === "trial") {
    await prisma.organization.updateMany({
      where: { id: organizationId, freeAiResponsesRemaining: { lt: TRIAL.messages } },
      data: { freeAiResponsesRemaining: { increment: 1 } },
    });
    return;
  }
  await prisma.billingSubscription.updateMany({
    where: { organizationId, periodStartedAt: reservation.periodStartedAt, messagesUsed: { gt: 0 } },
    data: { messagesUsed: { decrement: 1 } },
  });
}

/**
 * Prévient le propriétaire (email) que l'assistant ne peut plus répondre faute de messages, au plus une fois par 24 h.
 * Ne lève jamais.
 */
export async function notifyQuotaReached(organizationId: string, reason: DenyReason, now = new Date()) {
  try {
    const claimed = await prisma.organization.updateMany({
      where: { id: organizationId, OR: [{ quotaNoticeAt: null }, { quotaNoticeAt: { lt: new Date(now.getTime() - QUOTA_NOTICE_EVERY_MS) } }] },
      data: { quotaNoticeAt: now },
    });
    if (claimed.count === 0) return false;
    void notifyOrganizationAdmins(organizationId, (organizationName) => buildQuotaReachedEmail({ organizationName, reason }));
    return true;
  } catch (error) {
    console.error(`[org:${organizationId}] Avis de quota ignoré :`, error);
    return false;
  }
}

export interface OrganizationBillingStatus {
  plan: string;
  planName: string;
  status: "ACTIVE" | "EXPIRED";
  isTrial: boolean;
  /** Les forfaits sont-ils appliqués sur ce serveur ? Sinon rien n'est coupé. */
  enforced: boolean;
  /** L'assistant ne répond plus (uniquement quand les forfaits sont appliqués). */
  blocked: boolean;
  messageLimit: number;
  messagesUsed: number;
  remainingMessages: number;
  periodStartedAt: Date | null;
  expiresAt: Date | null;
  amount: number | null;
  features: PlanFeatures;
  activeWhatsAppChannels: number;
  assistants: number;
  responsibleLimit: number | null;
}

function planOrNull(key: string): BillingPlan | null {
  try {
    return getBillingPlan(key);
  } catch {
    return null;
  }
}

export async function getOrganizationBillingStatus(organizationId: string): Promise<OrganizationBillingStatus> {
  const [subscription, organization] = await Promise.all([
    prisma.billingSubscription.findUnique({ where: { organizationId } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { freeAiResponsesRemaining: true } }),
  ]);
  const now = new Date();
  const enforced = state.enforced;

  if (subscription) {
    const plan = planOrNull(subscription.plan);
    const active = subscription.status === "ACTIVE" && subscription.expiresAt > now;
    const periodOver = now.getTime() - subscription.periodStartedAt.getTime() >= BILLING_PERIOD_MS;
    const used = periodOver ? 0 : subscription.messagesUsed;
    const remaining = Math.max(0, subscription.messageLimit - used);
    return {
      plan: plan?.key ?? subscription.plan,
      planName: plan?.name ?? subscription.plan,
      status: active ? "ACTIVE" : "EXPIRED",
      isTrial: false,
      enforced,
      blocked: enforced && (!active || remaining <= 0),
      messageLimit: subscription.messageLimit,
      messagesUsed: used,
      remainingMessages: remaining,
      periodStartedAt: subscription.periodStartedAt,
      expiresAt: subscription.expiresAt,
      amount: plan?.amount ?? null,
      features: active ? (plan?.features ?? NO_FEATURES) : NO_FEATURES,
      activeWhatsAppChannels: plan?.activeWhatsAppChannels ?? 1,
      assistants: plan?.assistants ?? 1,
      responsibleLimit: null,
    };
  }

  const remaining = organization?.freeAiResponsesRemaining ?? 0;
  return {
    plan: "trial",
    planName: "Essai gratuit",
    status: remaining > 0 ? "ACTIVE" : "EXPIRED",
    isTrial: true,
    enforced,
    blocked: enforced && remaining <= 0,
    messageLimit: TRIAL.messages,
    messagesUsed: Math.max(0, TRIAL.messages - remaining),
    remainingMessages: remaining,
    periodStartedAt: null,
    expiresAt: null,
    amount: null,
    features: remaining > 0 ? TRIAL.features : NO_FEATURES,
    activeWhatsAppChannels: 1,
    assistants: 1,
    responsibleLimit: null,
  };
}

/** Fonctions ouvertes pour l'entreprise : tout, tant que les forfaits ne sont pas appliqués. */
export async function getOrganizationFeatures(organizationId: string): Promise<PlanFeatures> {
  if (!state.enforced) return ALL_FEATURES;
  return (await getOrganizationBillingStatus(organizationId)).features;
}

/** Refuse (402) une fonction réservée à un forfait supérieur. */
export async function assertFeature(organizationId: string, feature: "broadcasts" | "followUps") {
  const features = await getOrganizationFeatures(organizationId);
  if (features[feature]) return;
  const required = cheapestPlanWith(feature);
  const text = feature === "broadcasts"
    ? "Les messages en masse ne sont pas inclus dans votre forfait actuel. Ils sont"
    : "Les relances automatiques ne sont pas incluses dans votre forfait actuel. Elles sont";
  throw new PlanLimitError(`${text} disponibles à partir du forfait ${required.name} (page « Mon forfait »).`);
}

/** Refuse (402) l'ajout d'un employé au-delà de ce que le forfait permet. */
export async function assertCanAddTeamMember(organizationId: string, currentEmployees: number) {
  const { teamMembers } = await getOrganizationFeatures(organizationId);
  if (currentEmployees < teamMembers) return;
  const next = Object.values(BILLING_PLANS).sort((a, b) => a.amount - b.amount).find((plan) => plan.features.teamMembers > currentEmployees);
  throw new PlanLimitError(
    teamMembers === 0
      ? `Les employés ne sont pas inclus dans votre forfait actuel.${next ? ` Ils sont disponibles à partir du forfait ${next.name} (page « Mon forfait »).` : ""}`
      : `Votre forfait permet ${teamMembers} employé${teamMembers > 1 ? "s" : ""}.${next ? ` Passez au forfait ${next.name} pour en ajouter.` : ""}`,
  );
}
