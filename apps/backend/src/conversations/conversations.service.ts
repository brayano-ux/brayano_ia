import { findOrCreateContact } from "../contacts/contacts.service.js";
import { prisma } from "../database/client.js";
import type {
  RecordInboundMessageInput,
  RecordOutboundMessageInput,
} from "./conversations.types.js";

async function findOrCreateConversation(organizationId: string, contactId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { organizationId, contactId, status: "OPEN" },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: { organizationId, contactId },
  });
}

/**
 * Point d'entrée appelé par whatsapp.registry.ts quand un message texte arrive.
 * Ce module ne connaît rien de Baileys — uniquement des données déjà normalisées.
 */
export async function recordInboundMessage(input: RecordInboundMessageInput) {
  const contact = await findOrCreateContact(input.organizationId, input.fromJid);
  const conversation = await findOrCreateConversation(input.organizationId, contact.id);

  // Déduplication : si Baileys renvoie deux fois le même message (retry réseau),
  // on ignore silencieusement plutôt que de planter sur la contrainte unique.
  const alreadyExists = await prisma.message.findUnique({
    where: { externalId: input.externalId },
  });
  if (alreadyExists) {
    return { conversation, message: alreadyExists, isDuplicate: true as const };
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      author: "CONTACT",
      type: "TEXT",
      content: input.text,
      externalId: input.externalId,
      createdAt: input.timestamp,
    },
  });

  return { conversation, message, isDuplicate: false as const };
}

export async function recordOutboundMessage(input: RecordOutboundMessageInput) {
  return prisma.message.create({
    data: {
      conversationId: input.conversationId,
      direction: "OUTBOUND",
      author: input.author,
      type: "TEXT",
      content: input.text,
    },
  });
}

export async function listConversations(organizationId: string) {
  return prisma.conversation.findMany({
    where: { organizationId },
    include: { contact: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function setConversationAiEnabled(conversationId: string, aiEnabled: boolean) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { aiEnabled },
  });
}

export async function getConversationWithMessages(conversationId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      contact: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
}

const MAX_HISTORY_MESSAGES = 10;

/**
 * Contexte envoyé au LLM (Phase 6). La vraie stratégie de mémoire
 * (résumé + profil prospect + documents pertinents, Phase 0/7) viendra
 * remplacer ce simple "N derniers messages" sans changer l'appelant.
 */
export async function getRecentHistoryForAi(conversationId: string) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY_MESSAGES,
  });

  return messages
    .reverse()
    .map((message) => ({
      role: message.direction === "INBOUND" ? ("user" as const) : ("assistant" as const),
      content: message.content,
    }));
}
