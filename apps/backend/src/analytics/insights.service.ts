import { prisma } from "../database/client.js";

/**
 * Ce que l'assistant rapporte, au-delà des volumes : combien de conversations aboutissent, quels articles
 * intéressent les clients, et quelles questions sont restées sans réponse faute d'information.
 */
export interface ConversionStats {
  /** Conversations où le client a écrit au moins une fois sur la période. */
  activeConversations: number;
  /** Parmi elles, celles qui ont donné une commande ou un rendez-vous (non annulés) sur la période. */
  converted: number;
  /** Pourcentage arrondi, null s'il n'y a eu aucune conversation. */
  rate: number | null;
}

export interface TopProduct {
  productId: string;
  name: string;
  /** Clients (conversations) qui ont parlé de cet article ou en ont reçu la photo. */
  interested: number;
  photos: number;
  /** Quantité commandée sur la période. */
  ordered: number;
}

export interface UnansweredQuestion {
  messageId: string;
  conversationId: string;
  at: string;
  contact: string;
  /** Ce qui a manqué à l'assistant, résumé par lui (« délai de livraison à Bafoussam »). */
  missing: string;
  /** Dernier message du client avant cette réponse. */
  question: string | null;
}

export interface Insights {
  conversion: ConversionStats;
  topProducts: TopProduct[];
  unanswered: { count: number; items: UnansweredQuestion[] };
}

export const TOP_PRODUCTS_LIMIT = 5;
export const UNANSWERED_LIMIT = 6;

function contactLabel(displayName: string | null, jid: string): string {
  if (displayName?.trim()) return displayName.trim();
  return jid.endsWith("@s.whatsapp.net") ? `+${jid.split("@")[0]}` : "Client";
}

export async function getInsights(organizationId: string, start: Date, now: Date, orders: Array<{ items: unknown }>): Promise<Insights> {
  const [activeRows, convertedRows, discussedRows, photoRows, unansweredCountRows, unansweredRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(DISTINCT m.conversation_id) AS count
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id = ${organizationId} AND m.direction = 'INBOUND' AND m.created_at >= ${start} AND m.created_at <= ${now}`,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(DISTINCT x.conversation_id) AS count FROM (
        SELECT conversation_id FROM orders
        WHERE organization_id = ${organizationId} AND created_at >= ${start} AND created_at <= ${now} AND status <> 'CANCELLED' AND conversation_id IS NOT NULL
        UNION
        SELECT conversation_id FROM appointments
        WHERE organization_id = ${organizationId} AND created_at >= ${start} AND created_at <= ${now} AND status <> 'CANCELLED' AND conversation_id IS NOT NULL
      ) x`,
    prisma.$queryRaw<Array<{ product_id: string; conversation_id: string; name: string | null }>>`
      SELECT m.ai_meta->>'discussedProductId' AS product_id, m.conversation_id, max(m.ai_meta->>'discussedProductName') AS name
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id = ${organizationId} AND m.direction = 'OUTBOUND' AND m.created_at >= ${start} AND m.created_at <= ${now}
        AND m.ai_meta->>'discussedProductId' IS NOT NULL
      GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ product_id: string; conversation_id: string; photos: bigint }>>`
      SELECT s.product_id, s.conversation_id, count(*) AS photos
      FROM sent_product_images s JOIN conversations c ON c.id = s.conversation_id
      WHERE c.organization_id = ${organizationId} AND s.created_at >= ${start} AND s.created_at <= ${now}
      GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id = ${organizationId} AND m.direction = 'OUTBOUND' AND m.created_at >= ${start} AND m.created_at <= ${now}
        AND coalesce(m.ai_meta->>'missingInfo', '') <> ''`,
    prisma.$queryRaw<Array<{ id: string; conversation_id: string; created_at: Date; missing: string; display_name: string | null; whatsapp_jid: string }>>`
      SELECT m.id, m.conversation_id, m.created_at, m.ai_meta->>'missingInfo' AS missing, ct.display_name, ct.whatsapp_jid
      FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.organization_id = ${organizationId} AND m.direction = 'OUTBOUND' AND m.created_at >= ${start} AND m.created_at <= ${now}
        AND coalesce(m.ai_meta->>'missingInfo', '') <> ''
      ORDER BY m.created_at DESC
      LIMIT ${UNANSWERED_LIMIT}`,
  ]);

  const activeConversations = Number(activeRows[0]?.count ?? 0);
  // Une commande saisie à la main peut être rattachée à une conversation silencieuse sur la période : jamais plus de 100 %.
  const converted = Math.min(Number(convertedRows[0]?.count ?? 0), activeConversations);

  const products = new Map<string, { conversations: Set<string>; photos: number; ordered: number; name: string | null }>();
  const entryFor = (productId: string) => {
    let entry = products.get(productId);
    if (!entry) {
      entry = { conversations: new Set(), photos: 0, ordered: 0, name: null };
      products.set(productId, entry);
    }
    return entry;
  };
  for (const row of discussedRows) {
    const entry = entryFor(row.product_id);
    entry.conversations.add(row.conversation_id);
    entry.name ??= row.name;
  }
  for (const row of photoRows) {
    const entry = entryFor(row.product_id);
    entry.conversations.add(row.conversation_id);
    entry.photos += Number(row.photos);
  }
  for (const order of orders) {
    for (const line of Array.isArray(order.items) ? order.items : []) {
      const item = line as { productId?: unknown; name?: unknown; quantity?: unknown };
      if (typeof item.productId !== "string" || !item.productId) continue;
      const entry = entryFor(item.productId);
      entry.ordered += typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
      if (typeof item.name === "string" && item.name) entry.name ??= item.name;
    }
  }

  // Le nom actuel du produit prime ; un produit supprimé depuis garde le nom noté au moment de l'échange.
  const current = products.size
    ? await prisma.product.findMany({ where: { organizationId, id: { in: [...products.keys()] } }, select: { id: true, name: true } })
    : [];
  const currentNames = new Map(current.map((product) => [product.id, product.name]));
  const topProducts = [...products.entries()]
    .map(([productId, entry]) => ({ productId, name: currentNames.get(productId) ?? entry.name, interested: entry.conversations.size, photos: entry.photos, ordered: entry.ordered }))
    .filter((product): product is TopProduct => Boolean(product.name))
    .sort((a, b) => b.interested - a.interested || b.ordered - a.ordered || b.photos - a.photos || a.name.localeCompare(b.name, "fr"))
    .slice(0, TOP_PRODUCTS_LIMIT);

  const items = await Promise.all(unansweredRows.map(async (row): Promise<UnansweredQuestion> => {
    const question = await prisma.message.findFirst({
      where: { conversationId: row.conversation_id, direction: "INBOUND", createdAt: { lte: row.created_at } },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    return {
      messageId: row.id,
      conversationId: row.conversation_id,
      at: row.created_at.toISOString(),
      contact: contactLabel(row.display_name, row.whatsapp_jid),
      missing: row.missing,
      question: question?.content ? question.content.slice(0, 240) : null,
    };
  }));

  return {
    conversion: { activeConversations, converted, rate: activeConversations ? Math.round((converted / activeConversations) * 100) : null },
    topProducts,
    unanswered: { count: Number(unansweredCountRows[0]?.count ?? 0), items },
  };
}
