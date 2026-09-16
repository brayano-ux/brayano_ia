import fs from "node:fs";
import path from "node:path";
import { getOrCreateAiSettings, resolveResponseDelaySeconds } from "../ai/ai-settings.service.js";
import { getAiOrchestrator } from "../ai/ai.factory.js";
import { buildSystemPrompt } from "../ai/prompt.js";
import { env } from "../config/env.js";
import {
  getRecentHistoryForAi,
  recordInboundMessage,
  recordOutboundMessage,
  setConversationAiEnabled,
  shouldReactivateAiAfterHandoff,
  updateConversationQualification,
} from "../conversations/conversations.service.js";
import { prisma } from "../database/client.js";
import { registerQualifiedLead } from "../lead-routing/lead-routing.service.js";
import { BaileysWhatsAppProvider } from "./baileys.provider.js";
import type {
  IncomingWhatsAppMessage,
  WhatsAppConnectionStatus,
  WhatsAppProvider,
} from "./whatsapp.types.js";

// Une instance de provider par entreprise. Chaque organisation a sa propre
// session Baileys (donc son propre numéro WhatsApp), son propre historique
// de conversations, et sa propre configuration IA (ai_settings).
const providers = new Map<string, WhatsAppProvider>();
const connectionAttempts = new Map<string, Promise<void>>();

const resolvedAuthDir = path.resolve(env.WHATSAPP_AUTH_DIR);
if (!fs.existsSync(resolvedAuthDir)) {
  fs.mkdirSync(resolvedAuthDir, { recursive: true });
}

async function getOrCreateAccount(organizationId: string) {
  const existing = await prisma.whatsAppAccount.findFirst({ where: { organizationId } });
  if (existing) return existing;

  return prisma.whatsAppAccount.create({
    data: { organizationId, status: "DISCONNECTED" },
  });
}

function getOrCreateProvider(organizationId: string): WhatsAppProvider {
  const existing = providers.get(organizationId);
  if (existing) return existing;

  const authDir = path.join(resolvedAuthDir, organizationId);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const instance = new BaileysWhatsAppProvider(authDir);
  providers.set(organizationId, instance);

  instance.onConnectionUpdate(async ({ status, phoneNumber }) => {
    const account = await getOrCreateAccount(organizationId);
    await prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: { status, ...(phoneNumber ? { phoneNumber } : {}) },
    });
  });

  instance.onMessage(async (message: IncomingWhatsAppMessage) => {
    try {
      if (message.audio) {
        const transcription = await getAiOrchestrator().transcribeAudio(message.audio);
        if (!transcription) {
          console.warn(`[org:${organizationId}] Audio reçu sans transcription exploitable.`);
          return;
        }
        message.text = `[Transcription audio] ${transcription}`;
      }

      const { conversation, isDuplicate } = await recordInboundMessage({
        organizationId,
        fromJid: message.fromJid,
        externalId: message.externalId,
        text: message.text,
        timestamp: message.timestamp,
      });

      if (isDuplicate) return;

      const replyStartedAt = Date.now();

      console.log(`📩 [org:${organizationId}] Message enregistré :`, {
        from: message.fromJid,
        text: message.text,
      });

      const shouldReactivateAi =
        conversation.status === "HUMAN_HANDOFF" &&
        conversation.aiEnabled === false &&
        shouldReactivateAiAfterHandoff(conversation.updatedAt);

      if (shouldReactivateAi) {
        const reactivated = await setConversationAiEnabled(conversation.id, true);
        console.log(
          `🔄 [org:${organizationId}] IA réactivée après 24h de handoff pour conversation ${conversation.id}`,
        );
        conversation.aiEnabled = reactivated.aiEnabled;
        conversation.status = reactivated.status;
      }

      if (!conversation.aiEnabled || conversation.status === "HUMAN_HANDOFF" || conversation.status === "CLOSED") {
        console.log(`⏸️  [org:${organizationId}] IA désactivée, en attente d'un humain.`);
        return;
      }

      const settings = await getOrCreateAiSettings(organizationId);
      const systemPrompt = buildSystemPrompt(settings);
      const history = await getRecentHistoryForAi(conversation.id);
      const aiReply = await getAiOrchestrator().getReply(conversation.id, systemPrompt, history);

      const qualificationFields = Array.isArray(settings.qualificationFields)
        ? settings.qualificationFields.filter((field): field is string => typeof field === "string")
        : [];
      const hasConfiguredQualification = qualificationFields.length > 0;
      const hasRequiredData = qualificationFields.every((field) => {
        const value = aiReply.leadData[field];
        return typeof value === "string" && value.trim().length > 0;
      });
      const handoff = aiReply.needsHuman || (hasRequiredData && aiReply.nextAction === "handoff");
      const stop = aiReply.nextAction === "stop" && (!hasConfiguredQualification || hasRequiredData);
      const qualificationStatus = hasConfiguredQualification && !hasRequiredData && aiReply.qualificationStatus === "qualified"
        ? "QUALIFYING"
        : aiReply.qualificationStatus.toUpperCase();
      await updateConversationQualification(conversation.id, {
        qualificationStatus: qualificationStatus as
          | "NOT_QUALIFIED"
          | "QUALIFYING"
          | "QUALIFIED",
        leadScore: aiReply.leadScore,
        leadData: JSON.parse(JSON.stringify(aiReply.leadData)),
        status: handoff ? "HUMAN_HANDOFF" : stop ? "CLOSED" : "OPEN",
        aiEnabled: !handoff && !stop,
      });

      const hasLeadData = Object.keys(aiReply.leadData).length > 0;
      const shouldRegisterLead = hasLeadData || aiReply.qualificationStatus === "qualified" || aiReply.leadScore >= 70;
      if (shouldRegisterLead && (!hasConfiguredQualification || hasRequiredData)) {
        await registerQualifiedLead({
          organizationId,
          conversationId: conversation.id,
          leadData: aiReply.leadData,
          leadScore: aiReply.leadScore,
          requiredFields: qualificationFields,
        });
      }

      await waitForConfiguredDelay(replyStartedAt, settings.responseDelaySeconds);
      await instance.sendMessage(message.fromJid, aiReply.reply);
      await recordOutboundMessage({
        conversationId: conversation.id,
        text: aiReply.reply,
        author: "AI",
      });

      if (aiReply.needsHuman) {
        console.log(
          `🙋 [org:${organizationId}] L'IA signale qu'un humain doit prendre le relais (intent: ${aiReply.intent}).`,
        );
      }
    } catch (error) {
      console.error(`❌ [org:${organizationId}] Échec du traitement du message entrant :`, error);
    }
  });

  return instance;
}

function waitForConfiguredDelay(startedAt: number, delaySeconds: unknown) {
  const remainingMs = resolveResponseDelaySeconds(delaySeconds) * 1000 - (Date.now() - startedAt);
  if (remainingMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remainingMs));
}

export async function connectWhatsAppAccount(organizationId: string): Promise<void> {
  const currentAttempt = connectionAttempts.get(organizationId);
  if (currentAttempt) {
    return currentAttempt;
  }

  const existingProvider = providers.get(organizationId);
  if (existingProvider?.getStatus() === "DISCONNECTED") {
    providers.delete(organizationId);
  }

  const attempt = getOrCreateProvider(organizationId)
    .connect()
    .finally(() => {
      connectionAttempts.delete(organizationId);
    });
  connectionAttempts.set(organizationId, attempt);
  await attempt;
}

export async function disconnectWhatsAppAccount(organizationId: string): Promise<void> {
  connectionAttempts.delete(organizationId);
  const provider = providers.get(organizationId);

  try {
    if (provider) {
      await provider.disconnect();
    }
  } finally {
    providers.delete(organizationId);
    fs.rmSync(path.join(resolvedAuthDir, organizationId), { recursive: true, force: true });
  }
}

export async function restoreWhatsAppConnections(): Promise<void> {
  const accounts = await prisma.whatsAppAccount.findMany({
    select: { organizationId: true, status: true },
  });

  for (const account of accounts) {
    const authDir = path.join(resolvedAuthDir, account.organizationId);
    const hasPersistedSession = fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0;
    const shouldRestore = account.status !== "DISCONNECTED" || hasPersistedSession;
    if (!shouldRestore) continue;

    try {
      console.log(`🔄 [startup] Restauration de la session WhatsApp pour org ${account.organizationId}`);
      await connectWhatsAppAccount(account.organizationId);
    } catch (error) {
      console.error(`❌ [startup] Échec de reconnexion WhatsApp pour org ${account.organizationId}:`, error);
    }
  }
}

export function getWhatsAppAccountStatus(organizationId: string): WhatsAppConnectionStatus {
  return providers.get(organizationId)?.getStatus() ?? "DISCONNECTED";
}

export function getWhatsAppAccountQr(organizationId: string): string | null {
  return providers.get(organizationId)?.getQRCode() ?? null;
}

export async function sendWhatsAppMessageForOrg(
  organizationId: string,
  jid: string,
  text: string,
): Promise<void> {
  const provider = providers.get(organizationId);
  if (!provider) {
    throw new Error("Ce compte WhatsApp n'est pas connecté pour cette entreprise.");
  }

  const recipientJid = jid.includes("@")
    ? jid
    : `${jid.replace(/\D/g, "")}@s.whatsapp.net`;
  await provider.sendMessage(recipientJid, text);
}
