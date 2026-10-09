import fs from "node:fs";
import path from "node:path";
import { getOrCreateAiSettings, resolveResponseDelaySeconds } from "../ai/ai-settings.service.js";
import { getAiOrchestrator } from "../ai/ai.factory.js";
import { buildSystemPrompt } from "../ai/prompt.js";
import { env } from "../config/env.js";
import {
  getRecentHistoryForAi,
  recordHumanReplyFromPhone,
  recordInboundMessage,
  recordOutboundMessage,
  isConversationUpdateStillCurrent,
  setConversationAiEnabled,
  shouldReactivateAiAfterHandoff,
  updateConversationQualification,
} from "../conversations/conversations.service.js";
import { applyAiBooking, loadAgendaPrompt } from "../appointments/appointments.service.js";
import { applyAiOrder, loadOrderPrompt } from "../orders/orders.service.js";
import { withConversationSendLock } from "../conversations/conversation-send-lock.js";
import { prisma } from "../database/client.js";
import { getPlatformSuspension } from "../organizations/platform-suspension.service.js";
import { registerQualifiedLead } from "../lead-routing/lead-routing.service.js";
import {
  buildProductDetailsMessage,
  buildProductImageCaption,
  resolveRequestedProductImage,
} from "../products/product-image-selection.js";
import { listProductsForAssistant } from "../products/products.service.js";
import {
  sendClientDisconnectEmail,
  sendClientRecoveredEmail,
  sendWhatsAppDisconnectAlert,
  sendWhatsAppRecoveredNotice,
} from "../notifications/whatsapp-alerts.js";
import { BaileysWhatsAppProvider } from "./baileys.provider.js";
import { createConnectionMonitor } from "./connection-monitor.js";
import { buildAccountHistoryUpdate } from "./disconnect-reasons.js";
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

/** Prévient le propriétaire quand un numéro reste déconnecté (voir connection-monitor.ts). */
const connectionMonitor = createConnectionMonitor({
  graceMs: env.WHATSAPP_ALERT_DELAY_MINUTES * 60_000,
  onAlert: (outage) => sendWhatsAppDisconnectAlert(outage).then(() => undefined),
  onRecovered: (outage, downMs) => sendWhatsAppRecoveredNotice(outage, downMs).then(() => undefined),
  clientGraceMs: env.WHATSAPP_CLIENT_ALERT_DELAY_MINUTES * 60_000,
  onClientAlert: (outage) => sendClientDisconnectEmail(outage).then(() => undefined),
  onClientRecovered: (outage) => sendClientRecoveredEmail(outage).then(() => undefined),
});

/** Traite les changements d'état d'une entreprise dans l'ordre où ils arrivent, même s'ils attendent la base. */
const statusQueues = new Map<string, Promise<void>>();
function enqueueStatusUpdate(organizationId: string, work: () => Promise<void>) {
  const previous = statusQueues.get(organizationId) ?? Promise.resolve();
  const next = previous.then(work, work);
  statusQueues.set(organizationId, next);
  return next;
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

  instance.onConnectionUpdate(({ status, phoneNumber, reason, detail }) => enqueueStatusUpdate(organizationId, async () => {
    let previouslyConnected = false;
    console.log(`📶 [org:${organizationId}] WhatsApp ${status}${detail ? ` : ${detail}` : reason ? ` (${reason})` : ""}`);
    try {
      const account = await getOrCreateAccount(organizationId);
      // Un numéro déjà enregistré s'est connecté au moins une fois : sa déconnexion mérite une alerte.
      previouslyConnected = Boolean(account.phoneNumber);
      await prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: {
          status,
          ...(phoneNumber ? { phoneNumber } : {}),
          ...buildAccountHistoryUpdate({ status, ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) }, new Date()),
        },
      });
    } catch (error) {
      console.error(`[org:${organizationId}] Échec de sauvegarde du statut WhatsApp :`, error);
    }
    connectionMonitor.handle(organizationId, { status, ...(reason ? { reason } : {}), ...(detail ? { detail } : {}), previouslyConnected });
  }));

  // Le gérant écrit lui-même au prospect depuis son téléphone : l'IA se tait pendant 24 h.
  instance.onHumanMessage?.(async (message) => {
    try {
      const result = await recordHumanReplyFromPhone({
        organizationId,
        toJid: message.toJid,
        externalId: message.externalId,
        text: message.text,
        timestamp: message.timestamp,
      });
      if (result.aiPaused) {
        console.log(`🙋 [org:${organizationId}] Un humain répond depuis le téléphone : IA en pause 24 h pour ce prospect.`);
      }
    } catch (error) {
      console.error(`❌ [org:${organizationId}] Réponse humaine depuis le téléphone non enregistrée :`, error);
    }
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

      const previousLeadData = conversation.leadData && typeof conversation.leadData === "object" && !Array.isArray(conversation.leadData)
        ? conversation.leadData as Record<string, unknown>
        : {};
      const settings = await getOrCreateAiSettings(organizationId);
      if (!settings.aiEnabled) {
        console.log(`⏸️  [org:${organizationId}] IA désactivée globalement depuis le dashboard.`);
        return;
      }
      const suspension = await getPlatformSuspension(organizationId);
      if (suspension.suspended) {
        console.log(`⛔ [org:${organizationId}] IA suspendue par l'administrateur de la plateforme.`);
        return;
      }
      const products = await listProductsForAssistant(organizationId);
      // L'agenda est optionnel : toute erreur ici ne doit jamais empêcher la réponse.
      const agenda = await loadAgendaPrompt(organizationId).catch((error) => {
        console.error(`❌ [agenda:${organizationId}] Chargement de l'agenda ignoré :`, error);
        return null;
      });
      const orderSection = await loadOrderPrompt(organizationId).catch((error) => {
        console.error(`❌ [orders:${organizationId}] Chargement des commandes ignoré :`, error);
        return null;
      });
      const systemPrompt = buildSystemPrompt({
        ...settings,
        knownLeadData: previousLeadData,
        products,
        agenda: agenda?.section ?? null,
        orders: orderSection,
      });
      const history = await getRecentHistoryForAi(conversation.id);
      const aiReply = await getAiOrchestrator().getReply(conversation.id, systemPrompt, history);

      const configuredQualificationFields = Array.isArray(settings.qualificationFields)
        ? settings.qualificationFields.filter((field): field is string => typeof field === "string")
        : [];
      const qualificationFields = configuredQualificationFields.length
        ? configuredQualificationFields
        : ["name", "city", "need"];
      const hasConfiguredQualification = configuredQualificationFields.length > 0;
      const mergedLeadData = { ...previousLeadData };
      for (const [field, value] of Object.entries(aiReply.leadData)) {
        if (typeof value === "string" && value.trim()) {
          mergedLeadData[field] = value;
        } else if (!(field in mergedLeadData)) {
          mergedLeadData[field] = value;
        }
      }
      const phoneValue = mergedLeadData.phone ?? mergedLeadData.telephone ?? mergedLeadData.tel ?? mergedLeadData.numero_telephone;
      if (typeof phoneValue === "string" && phoneValue.trim()) {
        mergedLeadData.phone = phoneValue;
        mergedLeadData.telephone = phoneValue;
        mergedLeadData.tel = phoneValue;
        mergedLeadData.numero_telephone = phoneValue;
      }
      const hasRequiredData = qualificationFields.every((field) => {
        const value = mergedLeadData[field];
        return typeof value === "string" && value.trim().length > 0;
      });
      const handoff = aiReply.needsHuman;
      const stop = aiReply.nextAction === "stop";
      const qualificationStatus = hasConfiguredQualification && !hasRequiredData && aiReply.qualificationStatus === "qualified"
        ? "QUALIFYING"
        : aiReply.qualificationStatus.toUpperCase();
      const updatedConversation = await updateConversationQualification(conversation.id, {
        qualificationStatus: qualificationStatus as
          | "NOT_QUALIFIED"
          | "QUALIFYING"
          | "QUALIFIED",
        leadScore: aiReply.leadScore,
        leadData: JSON.parse(JSON.stringify(mergedLeadData)),
        status: handoff ? "HUMAN_HANDOFF" : stop ? "CLOSED" : "OPEN",
        aiEnabled: !handoff && !stop,
      });
      if (!updatedConversation) {
        console.log(`[org:${organizationId}] Réponse IA ignorée : la conversation a changé d’état pendant le traitement.`);
        return;
      }

      const hasLeadData = Object.keys(mergedLeadData).length > 0;
      const shouldRegisterLead = hasLeadData || aiReply.qualificationStatus === "qualified" || aiReply.leadScore >= 70;
      if (shouldRegisterLead) {
        console.log(`[qualification:${organizationId}] Enregistrement du prospect`, {
          conversationId: conversation.id,
          aiQualificationStatus: aiReply.qualificationStatus,
          hasRequiredData,
          missingFields: qualificationFields.filter((field) => {
            const value = mergedLeadData[field];
            return typeof value !== "string" || !value.trim();
          }),
          leadDataKeys: Object.keys(mergedLeadData),
        });
        await registerQualifiedLead({
          organizationId,
          conversationId: conversation.id,
          leadData: mergedLeadData,
          leadScore: aiReply.leadScore,
          requiredFields: qualificationFields,
        });
      }

      await waitForConfiguredDelay(replyStartedAt, settings.responseDelaySeconds);

      const imageUrl = resolveRequestedProductImage({
        message: message.text,
        productId: aiReply.productId,
        products,
        legacyImageUrl: aiReply.imageUrl,
        configuredLegacyImageUrl: settings.agentImageUrl,
      });

      const selectedProduct = products.find((product) => product.id === aiReply.productId && product.imageUrl === imageUrl);
      const outboundText = selectedProduct
        ? buildProductDetailsMessage(aiReply.reply, selectedProduct)
        : aiReply.reply;

      const responseSent = await withConversationSendLock(conversation.id, async () => {
        if (!await isConversationUpdateStillCurrent(conversation.id, updatedConversation.updatedAt)) {
          return false;
        }

        let textToSend = outboundText;
        if (agenda && aiReply.booking) {
          const leadName = typeof mergedLeadData.name === "string" ? mergedLeadData.name : null;
          const phone = message.fromJid.endsWith("@s.whatsapp.net") ? message.fromJid.split("@")[0] ?? null : null;
          const outcome = await applyAiBooking(agenda, aiReply.booking, {
            organizationId,
            conversationId: conversation.id,
            contactJid: message.fromJid,
            contactName: leadName,
            contactPhone: phone,
          });
          if (outcome?.replaceReply) {
            textToSend = outcome.replaceReply;
          } else if (outcome?.appendToReply) {
            textToSend = `${outboundText}\n\n${outcome.appendToReply}`;
          }
        }

        if (orderSection && aiReply.order) {
          const leadName = typeof mergedLeadData.name === "string" ? mergedLeadData.name : null;
          const phone = message.fromJid.endsWith("@s.whatsapp.net") ? message.fromJid.split("@")[0] ?? null : null;
          const outcome = await applyAiOrder(aiReply.order, {
            organizationId,
            conversationId: conversation.id,
            contactJid: message.fromJid,
            contactName: leadName,
            contactPhone: phone,
          });
          if (outcome?.replaceReply) {
            textToSend = outcome.replaceReply;
          } else if (outcome?.appendToReply) {
            textToSend = `${textToSend}\n\n${outcome.appendToReply}`;
          }
        }

        if (imageUrl) {
          if (selectedProduct) {
            await instance.sendMessage(message.fromJid, textToSend);
            await instance.sendImage(message.fromJid, imageUrl, buildProductImageCaption(selectedProduct));
          } else {
            await instance.sendImage(message.fromJid, imageUrl, aiReply.reply);
            if (textToSend !== outboundText) await instance.sendMessage(message.fromJid, textToSend);
          }
        } else {
          await instance.sendMessage(message.fromJid, textToSend);
        }

        await recordOutboundMessage({
          conversationId: conversation.id,
          text: textToSend,
          author: "AI",
        });
        return true;
      });
      if (!responseSent) {
        console.log(`[org:${organizationId}] Réponse IA ignorée : un humain a pris le relais avant l’envoi.`);
        return;
      }

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

export async function connectWhatsAppAccountWithPairingCode(
  organizationId: string,
  phoneNumber: string,
): Promise<string> {
  const currentAttempt = connectionAttempts.get(organizationId);
  if (currentAttempt) await currentAttempt;

  const existingProvider = providers.get(organizationId);
  if (existingProvider?.getStatus() === "DISCONNECTED") {
    providers.delete(organizationId);
  }

  const provider = getOrCreateProvider(organizationId);
  if (!provider.connectWithPairingCode) {
    throw new Error("Ce fournisseur WhatsApp ne prend pas en charge le code d'association.");
  }

  const pairingAttempt = provider.connectWithPairingCode(phoneNumber);
  const trackedAttempt = pairingAttempt
    .then(() => undefined, () => undefined)
    .finally(() => {
      if (connectionAttempts.get(organizationId) === trackedAttempt) {
        connectionAttempts.delete(organizationId);
      }
    });
  connectionAttempts.set(organizationId, trackedAttempt);
  return pairingAttempt;
}

export async function disconnectWhatsAppAccount(organizationId: string): Promise<void> {
  connectionMonitor.markIntentional(organizationId);
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

export function getWhatsAppAccountPairingCode(organizationId: string): string | null {
  return providers.get(organizationId)?.getPairingCode?.() ?? null;
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
