import { findOrCreateContact } from "../contacts/contacts.service.js";
import { prisma } from "../database/client.js";
import type { Prisma } from "../generated/prisma/client.js";
import type {
  RecordInboundMessageInput,
  RecordOutboundMessageInput,
} from "./conversations.types.js";

type ConversationForRouting = {
  status: "OPEN" | "HUMAN_HANDOFF" | "CLOSED";
};

/**
 * Un contact = un fil. Après un takeover, on ne doit pas recréer une
 * conversation OPEN (sinon l'IA reprend immédiatement).
 * S'il existe déjà un doublon (bug précédent), on privilégie le handoff.
 */
export function selectActiveConversation<T extends ConversationForRouting>(
  conversations: T[],
): T | null {
  if (conversations.length === 0) return null;

  const handoff = conversations.find((conversation) => conversation.status === "HUMAN_HANDOFF");
  if (handoff) return handoff;

  const open = conversations.find((conversation) => conversation.status === "OPEN");
  if (open) return open;

  return conversations[0] ?? null;
}

async function findOrCreateConversation(organizationId: string, contactId: string) {
  const existing = await prisma.conversation.findMany({
    where: { organizationId, contactId },
    orderBy: { updatedAt: "desc" },
  });

  const active = selectActiveConversation(existing);
  if (active) return active;

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
    include: {
      contact: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listProspectsForExport(organizationId: string) {
  return prisma.conversation.findMany({
    where: { organizationId },
    include: {
      contact: true,
      messages: { orderBy: { createdAt: "asc" } },
      prospectLeads: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: { location: true, responsible: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export function shouldReactivateAiAfterHandoff(lastHandoffAt: Date | string): boolean {
  const handoffAt = new Date(lastHandoffAt);
  const now = new Date();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  return now.getTime() - handoffAt.getTime() >= twentyFourHoursMs;
}

export async function setConversationAiEnabled(conversationId: string, aiEnabled: boolean) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      aiEnabled,
      ...(aiEnabled
        ? { status: "OPEN" as const }
        : { status: "HUMAN_HANDOFF" as const }),
    },
  });
}

export async function updateConversationQualification(
  conversationId: string,
  input: {
    qualificationStatus: "NOT_QUALIFIED" | "QUALIFYING" | "QUALIFIED";
    leadScore: number;
    leadData: Prisma.InputJsonValue;
    status: "OPEN" | "HUMAN_HANDOFF" | "CLOSED";
    aiEnabled: boolean;
  },
) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      qualificationStatus: input.qualificationStatus,
      leadScore: input.leadScore,
      leadData: input.leadData,
      status: input.status,
      aiEnabled: input.aiEnabled,
    },
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
