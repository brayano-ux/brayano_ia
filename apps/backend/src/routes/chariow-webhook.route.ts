import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../database/client.js";

type RawBodyRequest = { rawBody?: Buffer };

function isValidSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const received = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Réception sécurisée des Pulses Chariow.
 * La livraison est persistée avant de répondre 2xx ; l'activation des abonnements
 * sera branchée lorsque les produits Chariow et leurs identifiants seront configurés.
 */
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

    try {
      await prisma.chariowPulseDelivery.create({
        data: {
          deliveryId,
          pulseId,
          event,
          payload: payload as object,
        },
      });
      request.log.info({ deliveryId, event }, "Chariow Pulse securely received");
      return { received: true, duplicate: false };
    } catch (error) {
      // Chariow réutilise le même delivery ID lors des nouvelles tentatives.
      const existing = await prisma.chariowPulseDelivery.findUnique({ where: { deliveryId } }).catch(() => null);
      if (existing) return { received: true, duplicate: true };
      request.log.error(error, "Failed to persist Chariow Pulse");
      reply.code(503);
      return { received: false, message: "Notification non enregistrée ; Chariow peut réessayer." };
    }
  });
}
