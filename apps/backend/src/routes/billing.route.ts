import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { BILLING_PLANS, TRIAL, getBillingPlan } from "../billing/billing-plans.js";
import { isBillingEnforced } from "../billing/subscription.service.js";
import { getOrganizationBillingStatus } from "../billing/subscription.service.js";
import { prisma } from "../database/client.js";
import { checkCampayPayment, createCampayCollection, getCampayChargeAmount, isCampayDemoMode } from "../services/payment.service.js";
import { requireAuth } from "./auth.route.js";

const createCheckoutSchema = z.object({
  plan: z.string().min(1, "Le forfait est requis."),
  phone: z.string().trim().min(8).max(20).regex(/^[+\d\s().-]+$/, "Numéro de téléphone invalide."),
});

const campayCallbackSchema = z.object({
  reference: z.string().min(1).optional(),
  external_reference: z.string().min(1).optional(),
}).refine((value) => value.reference || value.external_reference, "Référence Campay manquante.");

async function reconcilePayment(payment: {
  id: string;
  organizationId: string;
  providerReference: string | null;
  plan: string;
  amount: number;
  currency: string;
  status: string;
}) {
  if (payment.status === "SUCCESS") return "SUCCESS" as const;
  if (payment.status === "FAILED") return "FAILED" as const;
  if (!payment.providerReference) return "PENDING" as const;

  const transaction = await checkCampayPayment(payment.providerReference);
  const providerStatus = String(transaction.status ?? "PENDING").toUpperCase();
  if (providerStatus === "SUCCESS" || providerStatus === "SUCCESSFUL") {
    const amount = Number(transaction.amount);
    const currency = String(transaction.currency ?? "").toUpperCase();
    if (amount !== payment.amount || currency !== payment.currency.toUpperCase()) {
      throw new Error("Le montant ou la devise confirmés par Campay ne correspondent pas au paiement.");
    }

    const plan = getBillingPlan(payment.plan);
    await prisma.$transaction(async (transactionClient) => {
      const updated = await transactionClient.billingPayment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "SUCCESS" },
      });
      if (updated.count === 0) return;
      if (isCampayDemoMode()) return;

      const now = new Date();
      const currentSubscription = await transactionClient.billingSubscription.findUnique({
        where: { organizationId: payment.organizationId },
      });
      const isEarlyRenewal = currentSubscription?.status === "ACTIVE" && currentSubscription.expiresAt > now;
      const startsFrom = isEarlyRenewal
        ? currentSubscription.expiresAt
        : now;
      const expiresAt = new Date(startsFrom.getTime() + 30 * 24 * 60 * 60 * 1000);
      await transactionClient.billingSubscription.upsert({
        where: { organizationId: payment.organizationId },
        create: {
          organizationId: payment.organizationId,
          plan: plan.key,
          messageLimit: plan.messages,
          status: "ACTIVE",
          startedAt: now,
          periodStartedAt: now,
          messagesUsed: 0,
          expiresAt,
        },
        update: {
          plan: plan.key,
          messageLimit: plan.messages,
          status: "ACTIVE",
          ...(!isEarlyRenewal ? { periodStartedAt: now, messagesUsed: 0 } : {}),
          expiresAt,
        },
      });
    });
    return "SUCCESS" as const;
  }

  if (providerStatus === "FAILED" || providerStatus === "FAILURE") {
    await prisma.billingPayment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    return "FAILED" as const;
  }
  return "PENDING" as const;
}

export async function billingRoute(app: FastifyInstance) {
  app.get("/billing/plans", async () => ({
    plans: Object.values(BILLING_PLANS),
    trial: TRIAL,
    enforced: isBillingEnforced(),
    supportEmail: env.SUPPORT_EMAIL || null,
  }));

  app.get("/billing/account", async (request, reply) => {
    const session = await requireAuth(request.headers.authorization);
    if (!session?.organizationId) {
      reply.code(401);
      return { message: "Connectez-vous pour consulter votre formule." };
    }
    return getOrganizationBillingStatus(session.organizationId);
  });

  app.post("/billing/create-checkout", async (request, reply) => {
    const parsed = createCheckoutSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: parsed.error.issues[0]?.message ?? "Informations de paiement invalides." };
    }

    const session = await requireAuth(request.headers.authorization);
    if (!session?.email || !session.organizationId) {
      reply.code(401);
      return { success: false, message: "Connectez-vous pour effectuer un paiement." };
    }

    let plan;
    try {
      plan = getBillingPlan(parsed.data.plan);
    } catch (error) {
      reply.code(400);
      return { success: false, message: error instanceof Error ? error.message : "Forfait invalide." };
    }

    const externalReference = randomUUID();
    const pendingPayment = await prisma.billingPayment.create({
      data: {
        organizationId: session.organizationId,
        externalReference,
        email: session.email,
        phone: parsed.data.phone,
        plan: plan.key,
        amount: getCampayChargeAmount(plan),
        currency: env.CAMPAY_CURRENCY,
      },
    });

    try {
      const payment = await createCampayCollection({
        plan: plan.key,
        phone: parsed.data.phone,
        email: session.email,
        externalReference,
      });
      await prisma.billingPayment.update({
        where: { id: pendingPayment.id },
        data: { providerReference: payment.reference },
      });

      return {
        success: true,
        reference: payment.reference,
        externalReference: payment.externalReference,
        ussdCode: payment.ussdCode,
        operator: payment.operator,
        chargedAmount: payment.chargedAmount,
        currency: payment.currency,
        demoMode: payment.demoMode,
        status: payment.status,
        provider: payment.provider,
        plan: payment.plan,
        message: "Validez la demande de paiement sur votre téléphone.",
      };
    } catch (error) {
      await prisma.billingPayment.update({
        where: { id: pendingPayment.id },
        data: { status: "FAILED" },
      }).catch((updateError) => app.log.error(updateError, "Failed to mark payment as failed"));
      app.log.error(error, "Checkout payment failed");
      reply.code(503);
      return {
        success: false,
        message: "Le paiement par Mobile Money n'a pas pu démarrer. Vérifiez votre numéro puis réessayez dans quelques minutes. Si cela continue, écrivez-nous.",
      };
    }
  });

  app.get<{ Params: { reference: string } }>("/billing/status/:reference", async (request, reply) => {
    const session = await requireAuth(request.headers.authorization);
    if (!session?.organizationId) {
      reply.code(401);
      return { message: "Connectez-vous pour consulter le paiement." };
    }

    try {
      const payment = await prisma.billingPayment.findFirst({
        where: { providerReference: request.params.reference, organizationId: session.organizationId },
      });
      if (!payment) {
        reply.code(404);
        return { message: "Paiement introuvable." };
      }
      const status = await reconcilePayment(payment);
      return { reference: request.params.reference, status };
    } catch (error) {
      app.log.error(error, "Campay payment status lookup failed");
      reply.code(503);
      return { message: "Le statut du paiement ne peut pas être vérifié pour le moment." };
    }
  });

  app.post("/billing/campay/callback", async (request, reply) => {
    const parsed = campayCallbackSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { message: "Notification Campay invalide." };
    }

    const payment = await prisma.billingPayment.findFirst({
      where: {
        OR: [
          ...(parsed.data.reference ? [{ providerReference: parsed.data.reference }] : []),
          ...(parsed.data.external_reference ? [{ externalReference: parsed.data.external_reference }] : []),
        ],
      },
    });
    if (!payment) {
      reply.code(404);
      return { message: "Paiement introuvable." };
    }

    try {
      const status = await reconcilePayment(payment);
      return { received: true, status };
    } catch (error) {
      app.log.error(error, "Campay callback verification failed");
      reply.code(503);
      return { message: "La notification sera revérifiée ultérieurement." };
    }
  });
}
