import { prisma } from "../database/client.js";

export async function logAiRun(input: {
  conversationId: string;
  provider: string;
  model: string;
  latencyMs: number;
  rawResponse: string;
  isValid: boolean;
}) {
  await prisma.aiRun.create({ data: input });
}
