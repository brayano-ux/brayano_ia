import { z } from "zod";
import { prisma } from "../database/client.js";
import { NotFoundError } from "../shared/errors.js";
import { buildOrderEmail, notifyOrganizationAdmins } from "../notifications/owner-notifications.js";
import {
  decideOrder,
  describeOrderOutcome,
  formatAmount,
  orderSignature,
  type OrderRequest,
} from "./order-logic.js";

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

export async function updateOrderStatus(organizationId: string, orderId: string, status: z.infer<typeof orderStatusSchema>) {
  const found = await prisma.order.findFirst({ where: { id: orderId, organizationId } });
  if (!found) throw new NotFoundError("Commande introuvable.");
  return prisma.order.update({ where: { id: orderId }, data: { status } });
}

/** Section de prompt : présente seulement si les commandes sont activées ET le catalogue non vide. */
export async function loadOrderPrompt(organizationId: string): Promise<string | null> {
  const settings = await prisma.orderSettings.findUnique({ where: { organizationId } });
  if (!settings?.enabled) return null;
  const products = await prisma.product.count({ where: { organizationId, active: true } });
  if (products === 0) return null;

  return `
PRISE DE COMMANDE (ACTIVÉE)

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

