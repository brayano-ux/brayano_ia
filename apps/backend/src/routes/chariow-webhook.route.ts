import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getBillingPlanByChariowProductId } from "../billing/billing-plans.js";
import { env } from "../config/env.js";
import { prisma } from "../database/client.js";

type RawBodyRequest = { rawBody?: Buffer };
type MinimalLogger = { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };

function isValidSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const received = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

type ChariowSuccessfulSalePayload = {
  sale?: {
    id?: unknown;
    amount?: { value?: unknown; currency?: unknown };
    custom_metadata?: unknown;
  };
  product?: { id?: unknown };
  customer?: { email?: unknown; phone?: unknown };
};

/**
 * Active (ou prolonge) l'abonnement d'une organisation après un paiement Chariow réussi.
 * L'identifiant de l'organisation vient de `sale.custom_metadata.organization_id`, déposé par
 * notre propre appel à /billing/checkout au moment de créer la session de paiement : comme tout
 * le payload est vérifié par signature HMAC, c'est une source fiable — jamais celle du navigateur.
 *
 * Idempotent par construction : `providerReference` (l'identifiant de vente Chariow) est unique sur
 * BillingPayment, donc une notification rejouée ou retentée ne réétend jamais l'abonnement deux fois.
 */
async function activateSubscriptionFromSuccessfulSale(payload: unknown, log: MinimalLogger): Promise<void> {
  const body = payload as ChariowSuccessfulSalePayload;
  const saleId = body.sale?.id;
  const productId = body.product?.id;
  const metadata = body.sale?.custom_metadata;
  const organizationId = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).organization_id
    : undefined;

  if (typeof saleId !== "string" || !saleId.trim()) {
    log.warn({ saleId }, "Chariow successful.sale sans identifiant de vente exploitable, activation ignorée.");
    return;
  }
  if (typeof productId !== "string" || !productId.trim()) {
    log.warn({ saleId, productId }, "Chariow successful.sale sans identifiant de produit exploitable, activation ignorée.");
    return;
  }
  if (typeof organizationId !== "string" || !organizationId.trim()) {
    log.warn({ saleId }, "Chariow successful.sale sans référence d'organisation (custom_metadata), activation ignorée.");
    return;
  }

  const plan = getBillingPlanByChariowProductId(productId);
  if (!plan) {
    log.warn({ saleId, productId }, "Chariow successful.sale pour un produit non relié à un forfait, activation ignorée.");
    return;
  }

  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) {
    log.error({ saleId, organizationId }, "Chariow successful.sale référence une organisation introuvable, activation ignorée.");
    return;
  }

  const email = typeof body.customer?.email === "string" ? body.customer.email : "inconnu@chariow.com";
  const phone = typeof body.customer?.phone === "string" ? body.customer.phone : "";
  const amount = typeof body.sale?.amount?.value === "number" ? Math.round(body.sale.amount.value) : plan.amount;
  const currency = typeof body.sale?.amount?.currency === "string" ? body.sale.amount.currency : "XAF";

  try {
    await prisma.billingPayment.create({
      data: {
        organizationId,
        externalReference: randomUUID(),
        providerReference: saleId,
        provider: "chariow",
        email,
        phone,
        plan: plan.key,
        amount,
        currency,
        status: "SUCCESS",
      },
    });
  } catch {
    // providerReference est unique : cette vente a déjà été traitée (notification rejouée ou retentée).
    // L'abonnement a déjà été étendu la première fois, on ne le refait pas.
    log.info({ saleId }, "Paiement Chariow déjà enregistré, abonnement non réétendu.");
    return;
  }

  const now = new Date();
  const currentSubscription = await prisma.billingSubscription.findUnique({ where: { organizationId } });
  const isEarlyRenewal = Boolean(currentSubscription) && currentSubscription!.status === "ACTIVE" && currentSubscription!.expiresAt > now;
  const startsFrom = isEarlyRenewal ? currentSubscription!.expiresAt : now;
  const expiresAt = new Date(startsFrom.getTime() + 30 * 24 * 60 * 60 * 1000);

  await prisma.billingSubscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
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
      // Nouvelle échéance : l'avis « bientôt terminé » pourra être renvoyé pour ce prochain cycle.
      expiringNoticeSentAt: null,
    },
  });

  log.info({ saleId, organizationId, plan: plan.key }, "Abonnement Chariow activé.");
}

/** Réception sécurisée des Pulses Chariow, avec activation de l'abonnement sur `successful.sale`. */
export async function chariowWebhookRoute(app: FastifyInstance) {
  app.post("/billing/chariow/pulse", async (request, reply) => {
    const secret = env.CHARIOW_PULSE_SECRET;
    if (!secret) {
      request.log.error("CHARIOW_PULSE_SECRET is not configured");
      reply.code(503);
      return { received: false, message: "Webhook Chariow non configuré." };
    }

    const rawBody = (request as typeof request & RawBodyRequest).rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      reply.code(400);
      return { received: false, message: "Corps brut de la notification manquant." };
    }

    if (!isValidSignature(rawBody, request.headers["x-chariow-signature"] as string | undefined, secret)) {
      reply.code(401);
      return { received: false, message: "Signature Chariow invalide." };
    }

    const deliveryId = request.headers["x-pulse-delivery-id"];
    const pulseId = request.headers["x-pulse-id"];
    const event = request.headers["x-pulse-event"];
    if (typeof deliveryId !== "string" || !deliveryId.trim()
      || typeof pulseId !== "string" || !pulseId.trim()
      || typeof event !== "string" || !event.trim()) {
      reply.code(400);
      return { received: false, message: "En-têtes Pulse incomplets." };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      reply.code(400);
      return { received: false, message: "JSON Chariow invalide." };
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      reply.code(400);
      return { received: false, message: "Format de notification Chariow invalide." };
    }

    let delivery: { id: string; processedAt: Date | null };
    try {
      delivery = await prisma.chariowPulseDelivery.create({
        data: { deliveryId, pulseId, event, payload: payload as object },
      });
    } catch (error) {
      // Chariow réutilise le même delivery ID lors des nouvelles tentatives.
      const existing = await prisma.chariowPulseDelivery.findUnique({ where: { deliveryId } }).catch(() => null);
      if (!existing) {
        request.log.error(error, "Failed to persist Chariow Pulse");
        reply.code(503);
        return { received: false, message: "Notification non enregistrée ; Chariow peut réessayer." };
      }
      // Déjà entièrement traitée lors d'une tentative précédente : rien à refaire.
      if (existing.processedAt) {
        return { received: true, duplicate: true };
      }
      delivery = existing;
      // Sinon (ex. le serveur est tombé après l'enregistrement mais avant l'activation) : on continue
      // ci-dessous avec le payload de cette tentative, strictement identique par contrat Chariow.
    }

    if (event === "successful.sale") {
      try {
        await activateSubscriptionFromSuccessfulSale(payload, request.log);
      } catch (error) {
        request.log.error(error, "Échec de l'activation de l'abonnement après un paiement Chariow réussi.");
        reply.code(503);
        return { received: true, message: "Notification enregistrée ; activation de l'abonnement à revérifier." };
      }
    }

    await prisma.chariowPulseDelivery.update({ where: { id: delivery.id }, data: { processedAt: new Date() } }).catch((error) => {
      request.log.error(error, "Impossible de marquer la notification Chariow comme traitée.");
    });

    request.log.info({ deliveryId, event }, "Chariow Pulse securely received");
    return { received: true, duplicate: false };
  });
}
