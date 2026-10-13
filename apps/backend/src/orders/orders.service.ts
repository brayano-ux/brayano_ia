import { z } from "zod";
import { prisma } from "../database/client.js";
import { NotFoundError } from "../shared/errors.js";
import { buildOrderCancellationEmail, buildOrderEmail, notifyOrganizationAdmins } from "../notifications/owner-notifications.js";
import {
  decideOrder,
  decideOrderCancellation,
  describeOrderOutcome,
  formatAmount,
  orderSignature,
  type ContactOrder,
  type OrderRequest,
} from "./order-logic.js";

const STATUS_LABEL: Record<ContactOrder["status"], string> = {
  NEW: "Nouvelle (pas encore confirmée par l'entreprise)",
  CONFIRMED: "Confirmée par l'entreprise",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
};

/** Commande la plus récente non annulée de ce client (pour le prompt et les annulations). */
export async function findLatestOpenOrder(organizationId: string, contactJid: string) {
  return prisma.order.findFirst({
    where: { organizationId, contactJid, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, createdAt: true, items: true, total: true, deliveryAddress: true },
  });
}

export async function getOrderSettings(organizationId: string) {
  return prisma.orderSettings.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
}

export async function updateOrderSettings(organizationId: string, input: { enabled: boolean }) {
  await getOrderSettings(organizationId);
  return prisma.orderSettings.update({ where: { organizationId }, data: { enabled: input.enabled } });
}

export const orderStatusSchema = z.enum(["NEW", "CONFIRMED", "DELIVERED", "CANCELLED"]);

export async function listOrders(organizationId: string, status?: string) {
  return prisma.order.findMany({
    where: { organizationId, ...(status ? { status: status as never } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

/** État des commandes d'un client, pour détecter les promesses non tenues de l'IA. */
export async function getContactOrderState(organizationId: string, contactJid: string, now = new Date()) {
  const [recent, openNew] = await Promise.all([
    prisma.order.count({
      where: { organizationId, contactJid, status: { not: "CANCELLED" }, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
    }),
    prisma.order.count({ where: { organizationId, contactJid, status: "NEW" } }),
  ]);
  return { hasRecentOrder: recent > 0, hasOpenNewOrder: openNew > 0 };
}

export async function updateOrderStatus(organizationId: string, orderId: string, status: z.infer<typeof orderStatusSchema>) {
  const found = await prisma.order.findFirst({ where: { id: orderId, organizationId } });
  if (!found) throw new NotFoundError("Commande introuvable.");
  return prisma.order.update({ where: { id: orderId }, data: { status } });
}

/** Section de prompt : présente seulement si les commandes sont activées ET le catalogue non vide. */
export async function loadOrderPrompt(organizationId: string, contactJid?: string): Promise<string | null> {
  const settings = await prisma.orderSettings.findUnique({ where: { organizationId } });
  if (!settings?.enabled) return null;
  const products = await prisma.product.count({ where: { organizationId, active: true } });
  if (products === 0) return null;

  const latest = contactJid ? await findLatestOpenOrder(organizationId, contactJid) : null;
  const items = latest ? (latest.items as Array<{ quantity: number; name: string }>) : [];
  const current = latest
    ? `Commande en cours de CE client : ${items.map((item) => `${item.quantity} × ${item.name}`).join(", ")}${latest.total != null ? ` (total ${formatAmount(latest.total)})` : ""} — statut : ${STATUS_LABEL[latest.status as ContactOrder["status"]]}.`
    : "Commande en cours de CE client : aucune.";

  return `
PRISE DE COMMANDE (ACTIVÉE)

${current}

Tu peux enregistrer des commandes, uniquement pour les produits du catalogue ci-dessus.

Pour une commande, recueille naturellement, sans tout demander d'un coup :
- le ou les produits et la quantité de chacun ;
- le nom du client ;
- l'adresse ou le quartier de livraison ;
- un numéro de téléphone si le client en donne un autre que son WhatsApp.

Règles :
- Ne propose et n'enregistre jamais un produit absent du catalogue. Utilise l'identifiant exact (productId) du catalogue.
- Ne donne jamais un prix qui n'est pas dans le catalogue. Ne calcule pas de remise.
- Avant d'enregistrer, récapitule la commande (produits, quantités, adresse) et attends la confirmation claire du client.
- Quand le client a confirmé, renseigne le champ "order" : {"action":"create","items":[{"productId":"…","quantity":1}],"customerName":"…","address":"…","phone":"…","notes":"…"}. Le serveur vérifie et enregistre réellement la commande.
- N'affirme « commande enregistrée » que si tu renseignes "order" dans cette même réponse. Sans "order", la commande n'est PAS enregistrée.
- Si aucune commande n'est confirmée, laisse "order" à null.
- Pour annuler la commande du client : renseigne {"action":"cancel"} dans "order" (le serveur retrouve la commande, l'annule si elle n'est pas encore confirmée par l'entreprise et prévient le propriétaire). N'affirme « commande annulée » que si tu renseignes "order" avec cette action dans cette même réponse.
- Si le client a déjà une commande en cours (voir ci-dessus) et en veut une nouvelle, enregistre une NOUVELLE commande avec "create" ; ne modifie pas l'ancienne.
- L'état « Commande en cours » ci-dessus est la seule vérité : les anciens messages de la conversation ne font pas foi.
`.trim();
}

export interface OrderContext {
  organizationId: string;
  conversationId: string;
  contactJid: string;
  contactName?: string | null | undefined;
  contactPhone?: string | null | undefined;
}

/** Ne lève jamais : en cas d'erreur la réponse WhatsApp part quand même (retourne null). */
export async function applyAiOrder(
  request: OrderRequest,
  context: OrderContext,
  now = new Date(),
): Promise<{ appendToReply: string | null; replaceReply: string | null } | null> {
  try {
    if (request.action === "cancel") {
      return await applyOrderCancellation(context);
    }
    const catalog = await prisma.product.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true, price: true },
    });
    const decision = decideOrder({
      request,
      catalog,
      fallbackName: context.contactName,
      fallbackPhone: context.contactPhone,
    });
    if (decision.kind !== "create") return describeOrderOutcome(decision);

    // Idempotence : la même commande répétée par l'IA ne crée pas de doublon.
    const signature = orderSignature(decision.items);
    const recent = await prisma.order.findMany({
      where: {
        organizationId: context.organizationId,
        contactJid: context.contactJid,
        status: { not: "CANCELLED" },
        createdAt: { gte: new Date(now.getTime() - 30 * 60_000) },
      },
      select: { items: true },
    });
    if (recent.some((order) => orderSignature(order.items as Array<{ productId: string; quantity: number }>) === signature)) {
      return describeOrderOutcome({ kind: "already_created" });
    }

    await prisma.order.create({
      data: {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        contactJid: context.contactJid,
        customerName: decision.customerName,
        customerPhone: decision.phone,
        deliveryAddress: decision.address,
        notes: decision.notes,
        items: decision.items as unknown as object,
        total: decision.total,
        source: "AI",
      },
    });

    void notifyOrganizationAdmins(context.organizationId, (organizationName) =>
      buildOrderEmail({
        organizationName,
        prospect: { name: decision.customerName, phone: decision.phone ?? context.contactPhone },
        items: decision.items,
        totalLabel: decision.total !== null ? formatAmount(decision.total) : null,
        address: decision.address,
        notes: decision.notes,
      }),
    );
    return describeOrderOutcome(decision);
  } catch (error) {
    console.error(`❌ [orders:${context.organizationId}] Échec de l'enregistrement de la commande :`, error);
    return null;
  }
}

async function applyOrderCancellation(context: OrderContext) {
  const orders = await prisma.order.findMany({
    where: { organizationId: context.organizationId, contactJid: context.contactJid },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, createdAt: true, items: true, total: true },
  });
  const decision = decideOrderCancellation(orders);
  if (decision.kind === "cancel") {
    // Le statut peut avoir changé entre la lecture et l'écriture (le propriétaire confirme en même temps).
    const updated = await prisma.order.updateMany({
      where: { id: decision.orderId, organizationId: context.organizationId, status: "NEW" },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
      return describeOrderOutcome({ kind: "cancel_too_late", orderId: decision.orderId, status: "CONFIRMED" });
    }
  }
  if (decision.kind === "cancel" || decision.kind === "cancel_too_late") {
    const order = orders.find((entry) => entry.id === decision.orderId);
    const items = (order?.items ?? []) as Array<{ quantity: number; name: string }>;
    void notifyOrganizationAdmins(context.organizationId, (organizationName) =>
      buildOrderCancellationEmail({
        organizationName,
        kind: decision.kind === "cancel" ? "cancelled" : "requested",
        prospect: { name: context.contactName, phone: context.contactPhone },
        items,
        totalLabel: order?.total != null ? formatAmount(order.total) : null,
      }),
    );
  }
  return describeOrderOutcome(decision);
}
