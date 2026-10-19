import { prisma } from "../database/client.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";

const MAX_ACTIVE_CORRECTIONS = 200;

export interface CorrectionInput {
  /** Question du client concernée. Vide ou absent = règle générale. */
  question?: string | undefined;
  correctReply: string;
}

function cleanQuestion(question: string | undefined) {
  return (question ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}

async function assertRoom(organizationId: string) {
  const count = await prisma.aiCorrection.count({ where: { organizationId, active: true } });
  if (count >= MAX_ACTIVE_CORRECTIONS) {
    throw new ValidationError(`Vous avez déjà ${MAX_ACTIVE_CORRECTIONS} corrections actives. Supprimez-en pour en ajouter.`);
  }
}

export async function listCorrections(organizationId: string) {
  return prisma.aiCorrection.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 500 });
}

export async function createCorrection(organizationId: string, input: CorrectionInput & { wrongReply?: string | undefined }) {
  await assertRoom(organizationId);
  return prisma.aiCorrection.create({
    data: {
      organizationId,
      question: cleanQuestion(input.question),
      wrongReply: input.wrongReply?.trim().slice(0, 1000) || null,
      correctReply: input.correctReply.trim(),
    },
  });
}

/**
 * Le propriétaire corrige une réponse de l'IA dans une conversation : on retient la question du client
 * (le dernier message du client avant cette réponse) et la bonne réponse.
 */
export async function createCorrectionFromMessage(
  organizationId: string,
  conversationId: string,
  messageId: string,
  input: { correctReply: string; general?: boolean | undefined },
) {
  const message = await prisma.message.findFirst({
    where: { id: messageId, conversationId, direction: "OUTBOUND", author: "AI", conversation: { organizationId } },
    select: { content: true, createdAt: true },
  });
  if (!message) throw new NotFoundError("Réponse introuvable dans cette conversation.");

  let question = "";
  if (!input.general) {
    const asked = await prisma.message.findFirst({
      where: { conversationId, direction: "INBOUND", createdAt: { lte: message.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (asked && !asked.content.trim().startsWith("[")) question = asked.content;
  }
  return createCorrection(organizationId, { question, correctReply: input.correctReply, wrongReply: message.content });
}

export async function updateCorrection(
  organizationId: string,
  id: string,
  input: { active?: boolean | undefined; correctReply?: string | undefined; question?: string | undefined },
) {
  const found = await prisma.aiCorrection.findFirst({ where: { id, organizationId } });
  if (!found) throw new NotFoundError("Correction introuvable.");
  if (input.active === true && !found.active) await assertRoom(organizationId);
  return prisma.aiCorrection.update({
    where: { id },
    data: {
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.correctReply !== undefined ? { correctReply: input.correctReply.trim() } : {}),
      ...(input.question !== undefined ? { question: cleanQuestion(input.question) } : {}),
    },
  });
}

export async function deleteCorrection(organizationId: string, id: string) {
  const found = await prisma.aiCorrection.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!found) throw new NotFoundError("Correction introuvable.");
  await prisma.aiCorrection.delete({ where: { id } });
}
