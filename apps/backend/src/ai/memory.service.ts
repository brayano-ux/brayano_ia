import { prisma } from "../database/client.js";
import {
  buildCorrectionsPrompt,
  buildExamplesPrompt,
  pickExamples,
  pickRelevantCorrections,
  type ExchangeCandidate,
} from "./memory.js";

export interface MemorySections {
  corrections: string | null;
  examples: string | null;
  correctionIds: string[];
  exampleCount: number;
}

const EMPTY: MemorySections = { corrections: null, examples: null, correctionIds: [], exampleCount: 0 };

/** Un texte écrit par le client (pas une note automatique du serveur comme « [Photo reçue] »). */
function isPlainText(content: string) {
  return content.trim().length >= 6 && !content.trim().startsWith("[");
}

/**
 * Paires « question du client → réponse » tirées de conversations passées terminées par une commande ou un rendez-vous.
 * Uniquement l'entreprise concernée : jamais d'échange d'une autre entreprise.
 */
export async function loadSuccessfulExchanges(organizationId: string, excludeConversationId: string): Promise<ExchangeCandidate[]> {
  const winners = await prisma.conversation.findMany({
    where: { organizationId, id: { not: excludeConversationId }, stage: "ORDERED" },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });
  if (!winners.length) return [];

  const messages = await prisma.message.findMany({
    where: { conversationId: { in: winners.map((conversation) => conversation.id) }, type: "TEXT" },
    orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }],
    select: { conversationId: true, direction: true, author: true, content: true },
    take: 4000,
  });

  const pairs: ExchangeCandidate[] = [];
  let pending: { conversationId: string; text: string } | null = null;
  for (const message of messages) {
    if (message.direction === "INBOUND") {
      pending = isPlainText(message.content) ? { conversationId: message.conversationId, text: message.content } : null;
      continue;
    }
    if (pending && pending.conversationId === message.conversationId && isPlainText(message.content)) {
      pairs.push({ customer: pending.text, reply: message.content });
    }
    pending = null;
  }
  return pairs;
}

/** Corrections et exemples utiles pour répondre à CE message. Ne lève jamais : la mémoire ne doit pas bloquer la réponse. */
export async function loadMemorySections(organizationId: string, conversationId: string, inboundText: string): Promise<MemorySections> {
  try {
    const [corrections, exchanges] = await Promise.all([
      prisma.aiCorrection.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, question: true, correctReply: true },
      }),
      inboundText.trim().startsWith("[") ? Promise.resolve([]) : loadSuccessfulExchanges(organizationId, conversationId),
    ]);
    const picked = pickRelevantCorrections(corrections, inboundText);
    const examples = pickExamples(exchanges, inboundText);
    if (picked.length) {
      void prisma.aiCorrection
        .updateMany({ where: { id: { in: picked.map((entry) => entry.id) }, organizationId }, data: { usedCount: { increment: 1 } } })
        .catch(() => undefined);
    }
    return {
      corrections: buildCorrectionsPrompt(picked),
      examples: buildExamplesPrompt(examples),
      correctionIds: picked.map((entry) => entry.id),
      exampleCount: examples.length,
    };
  } catch (error) {
    console.error(`❌ [memory:${organizationId}] Mémoire de l'assistant ignorée :`, error);
    return EMPTY;
  }
}
