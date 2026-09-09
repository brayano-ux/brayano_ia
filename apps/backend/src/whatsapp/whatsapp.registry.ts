import path from "node:path";
import { getOrCreateAiSettings } from "../ai/ai-settings.service.js";
import { getAiOrchestrator } from "../ai/ai.factory.js";
import { buildSystemPrompt } from "../ai/prompt.js";
import { env } from "../config/env.js";
import {
  getRecentHistoryForAi,
  recordInboundMessage,
  recordOutboundMessage,
} from "../conversations/conversations.service.js";
import { prisma } from "../database/client.js";
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

  const authDir = path.join(env.WHATSAPP_AUTH_DIR, organizationId);
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
      const { conversation, isDuplicate } = await recordInboundMessage({
        organizationId,
        fromJid: message.fromJid,
        externalId: message.externalId,
        text: message.text,
        timestamp: message.timestamp,
      });

      if (isDuplicate) return;

      console.log(`📩 [org:${organizationId}] Message enregistré :`, {
        from: message.fromJid,
        text: message.text,
      });

      if (!conversation.aiEnabled) {
        console.log(`⏸️  [org:${organizationId}] IA désactivée, en attente d'un humain.`);
        return;
      }

      const settings = await getOrCreateAiSettings(organizationId);
      const systemPrompt = buildSystemPrompt(settings);
      const history = await getRecentHistoryForAi(conversation.id);
      const aiReply = await getAiOrchestrator().getReply(conversation.id, systemPrompt, history);

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

export async function connectWhatsAppAccount(organizationId: string): Promise<void> {
  const currentAttempt = connectionAttempts.get(organizationId);
  if (currentAttempt) {
    return currentAttempt;
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
  if (!provider) return;
  await provider.disconnect();
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
  await provider.sendMessage(jid, text);
}
