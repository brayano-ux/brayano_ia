import { z } from "zod";

/**
 * Demande de commande renvoyée par l'IA. Aucun effet par elle-même : le serveur
 * revérifie chaque produit dans le catalogue réel de l'entreprise.
 * `.catch(undefined)` : une demande mal formée n'invalide pas toute la réponse.
 */
const orderCreateSchema = z.object({
  action: z.literal("create"),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(20),
  customerName: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(400).optional(),
  notes: z.string().trim().max(500).optional(),
});

/** Annulation de la dernière commande du client : le serveur retrouve la commande lui-même. */
const orderCancelSchema = z.object({
  action: z.literal("cancel"),
  notes: z.string().trim().max(500).optional(),
});

export const orderRequestSchema = z
  .discriminatedUnion("action", [orderCreateSchema, orderCancelSchema])
  .nullish()
  .catch(undefined);

export type OrderRequest = NonNullable<z.infer<typeof orderRequestSchema>>;
export type OrderCreateRequest = Extract<OrderRequest, { action: "create" }>;

export interface CatalogProduct {
  id: string;
  name: string;
  price: string | null;
}

export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: string | null;
  lineTotal: number | null;
}

export type OrderDecision =
  | { kind: "cancel"; orderId: string }
  /** Commande déjà confirmée ou livrée : seul le propriétaire peut la modifier ou l'annuler. */
  | { kind: "cancel_too_late"; orderId: string; status: string }
  | { kind: "nothing_to_cancel" }
  | {
      kind: "create";
      items: OrderLine[];
      total: number | null;
      customerName: string;
      address: string;
      phone: string | null;
      notes: string | null;
    }
  | { kind: "missing"; fields: Array<"address" | "customerName"> }
  | { kind: "unknown_product" };

/** « 25 000 FCFA » → 25000. Plusieurs nombres (fourchette) ou aucun → null. */
export function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const groups = value.match(/\d[\d\s.,  ]*/g);
  if (!groups || groups.length !== 1) return null;
  const digits = groups[0]!.replace(/\D/g, "");
  if (!digits || digits.length > 10) return null;
  return Number(digits);
}

export interface ContactOrder {
  id: string;
  status: "NEW" | "CONFIRMED" | "DELIVERED" | "CANCELLED";
  createdAt: Date;
}

/**
 * Annulation demandée par le client : on vise sa commande la plus récente non annulée.
 * Tant que le propriétaire ne l'a pas confirmée (statut NEW), l'IA peut l'annuler ;
 * ensuite il faut l'intervention du propriétaire.
 */
export function decideOrderCancellation(orders: ContactOrder[]): OrderDecision {
  const latest = [...orders]
    .filter((order) => order.status !== "CANCELLED")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latest) return { kind: "nothing_to_cancel" };
  if (latest.status === "NEW") return { kind: "cancel", orderId: latest.id };
  return { kind: "cancel_too_late", orderId: latest.id, status: latest.status };
}

export function decideOrder(input: {
  request: OrderCreateRequest;
  catalog: CatalogProduct[];
  fallbackName?: string | null | undefined;
  fallbackPhone?: string | null | undefined;
}): OrderDecision {
  const { request, catalog } = input;
  const byId = new Map(catalog.map((product) => [product.id, product]));

  // Lignes identiques fusionnées : l'IA répète parfois le même produit.
  const quantities = new Map<string, number>();
  for (const item of request.items) {
    if (!byId.has(item.productId)) return { kind: "unknown_product" };
    quantities.set(item.productId, Math.min(999, (quantities.get(item.productId) ?? 0) + item.quantity));
  }

  const items: OrderLine[] = [...quantities.entries()].map(([productId, quantity]) => {
    const product = byId.get(productId)!;
    const unit = parsePrice(product.price);
    return {
      productId,
      name: product.name,
      quantity,
      unitPrice: product.price,
      lineTotal: unit === null ? null : unit * quantity,
    };
  });

  const customerName = request.customerName?.trim() || input.fallbackName?.trim() || "";
  const address = request.address?.trim() || "";
  const missing: Array<"address" | "customerName"> = [];
  if (!address) missing.push("address");
  if (!customerName) missing.push("customerName");
  if (missing.length) return { kind: "missing", fields: missing };

  const total = items.every((line) => line.lineTotal !== null)
    ? items.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)
    : null;

  return {
    kind: "create",
    items,
    total,
    customerName,
    address,
    phone: request.phone?.trim() || input.fallbackPhone?.trim() || null,
    notes: request.notes?.trim() || null,
  };
}

export function orderSignature(items: Array<{ productId: string; quantity: number }>): string {
  return [...items]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((item) => `${item.productId}x${item.quantity}`)
    .join("|");
}

export function formatAmount(value: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(value).replace(/[  ]/g, " ")} FCFA`;
}

export function describeOrderOutcome(
  decision: OrderDecision | { kind: "already_created" },
): { appendToReply: string | null; replaceReply: string | null } {
  switch (decision.kind) {
    case "cancel":
      return { appendToReply: "✅ Commande annulée / Order cancelled.", replaceReply: null };
    case "nothing_to_cancel":
      return {
        appendToReply: null,
        replaceReply: "Je ne trouve aucune commande à annuler. / I can't find any order to cancel.",
      };
    case "cancel_too_late":
      return {
        appendToReply: null,
        replaceReply:
          "Votre commande est déjà confirmée : je ne peux plus l'annuler moi-même. J'ai prévenu l'équipe, qui va vous recontacter. / Your order is already confirmed, so I can't cancel it myself. I've notified our team, who will contact you.",
      };
    case "create":
      return {
        appendToReply: `✅ Commande enregistrée / Order recorded :\n${decision.items
          .map((line) => `• ${line.quantity} × ${line.name}`)
          .join("\n")}${decision.total !== null ? `\nTotal : ${formatAmount(decision.total)}` : ""}\n📍 ${decision.address}`,
        replaceReply: null,
      };
    case "already_created":
      return { appendToReply: "✅ Votre commande est déjà enregistrée / Your order is already recorded.", replaceReply: null };
    case "missing": {
      const fr = decision.fields.map((f) => (f === "address" ? "l'adresse de livraison" : "votre nom")).join(" et ");
      const en = decision.fields.map((f) => (f === "address" ? "the delivery address" : "your name")).join(" and ");
      return {
        appendToReply: null,
        replaceReply: `Pour enregistrer votre commande, j'ai besoin de ${fr}. / To record your order I need ${en}.`,
      };
    }
    case "unknown_product":
      return {
        appendToReply: null,
        replaceReply: "Je n'ai pas pu identifier ce produit dans notre catalogue. Pouvez-vous préciser lequel ? / I couldn't match that product in our catalogue. Which one do you mean?",
      };
  }
}
