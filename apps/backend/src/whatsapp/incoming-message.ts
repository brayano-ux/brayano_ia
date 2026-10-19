import { getOrCreateAiSettings, resolveResponseDelaySeconds } from "../ai/ai-settings.service.js";
import { getAiOrchestrator } from "../ai/ai.factory.js";
import { buildSystemPrompt } from "../ai/prompt.js";
import {
  getRecentHistoryForAi,
  recordInboundMessage,
  recordOutboundMessage,
  isConversationUpdateStillCurrent,
  setConversationAiEnabled,
  shouldReactivateAiAfterHandoff,
  updateConversationQualification,
} from "../conversations/conversations.service.js";
import { applyAiBooking, findContactUpcoming, loadAgendaPrompt } from "../appointments/appointments.service.js";
import { buildClaimCorrection, describeUnbackedClaims, findUnbackedClaims, type UnbackedClaim } from "../ai/claim-guard.js";
import { applyAiOrder, getContactOrderState, loadOrderPrompt } from "../orders/orders.service.js";
import { withConversationSendLock } from "../conversations/conversation-send-lock.js";
import { getPlatformSuspension } from "../organizations/platform-suspension.service.js";
import { registerQualifiedLead } from "../lead-routing/lead-routing.service.js";
import {
  buildProductDetailsMessage,
  buildProductImageCaption,
  resolveRequestedProductImage,
} from "../products/product-image-selection.js";
import { listProductsForAssistant } from "../products/products.service.js";
import type { IncomingWhatsAppMessage, WhatsAppProvider } from "./whatsapp.types.js";

export interface IncomingMessageContext {
  organizationId: string;
  instance: WhatsAppProvider;
}

function waitForConfiguredDelay(startedAt: number, delaySeconds: unknown) {
  const remainingMs = resolveResponseDelaySeconds(delaySeconds) * 1000 - (Date.now() - startedAt);
  if (remainingMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remainingMs));
}

/**
 * Traite UN message entrant d'un contact : enregistrement, décision (IA active ? suspendue ?),
 * réponse de l'IA, actions (rendez-vous, commande), envoi et enregistrement.
 * Ne lève jamais : une erreur ne doit pas casser le flux WhatsApp.
 */
export async function processIncomingMessage(context: IncomingMessageContext, message: IncomingWhatsAppMessage): Promise<void> {
  const { organizationId, instance } = context;
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
    const agenda = await loadAgendaPrompt(organizationId, new Date(), message.fromJid).catch((error) => {
      console.error(`❌ [agenda:${organizationId}] Chargement de l'agenda ignoré :`, error);
      return null;
    });
    const orderSection = await loadOrderPrompt(organizationId, message.fromJid).catch((error) => {
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
    let aiReply = await getAiOrchestrator().getReply(conversation.id, systemPrompt, history);

    // Garde-fou : le modèle dit « rendez-vous confirmé / annulé », « commande enregistrée / annulée »
    // sans demander l'action au serveur. On compare à l'état réel et on redemande UNE fois.
    let unbackedClaims: UnbackedClaim[] = [];
    if (agenda || orderSection) {
      try {
        const [upcoming, orderState] = await Promise.all([
          agenda ? findContactUpcoming(organizationId, message.fromJid) : Promise.resolve(null),
          orderSection ? getContactOrderState(organizationId, message.fromJid) : Promise.resolve({ hasRecentOrder: false, hasOpenNewOrder: false }),
        ]);
        const check = (reply: typeof aiReply) =>
          findUnbackedClaims({
            reply: reply.reply,
            agendaEnabled: Boolean(agenda),
            ordersEnabled: Boolean(orderSection),
            booking: reply.booking ?? null,
            order: reply.order ?? null,
            hasUpcomingAppointment: Boolean(upcoming),
            ...orderState,
          });
        unbackedClaims = check(aiReply);
        if (unbackedClaims.length) {
          console.warn(`⚠️ [org:${organizationId}] Promesse IA non tenue (${unbackedClaims.join(", ")}) : nouvelle tentative.`);
          const retry = await getAiOrchestrator().getReply(
            conversation.id,
            `${systemPrompt}\n\n${buildClaimCorrection(unbackedClaims)}`,
            history,
          );
          if (retry.intent !== "erreur_traitement") {
            aiReply = retry;
            unbackedClaims = check(retry);
          }
        }
      } catch (error) {
        console.error(`❌ [org:${organizationId}] Contrôle des promesses IA ignoré :`, error);
        unbackedClaims = [];
      }
    }

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

      if (unbackedClaims.length) {
        // Même après une seconde tentative, la réponse promet une action non faite : on le dit au client.
        textToSend = `${textToSend}\n\n${describeUnbackedClaims(unbackedClaims)}`;
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

}
