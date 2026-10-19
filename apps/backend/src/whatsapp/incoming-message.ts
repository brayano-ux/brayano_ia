import { getOrCreateAiSettings, resolveResponseDelaySeconds } from "../ai/ai-settings.service.js";
import { getAiOrchestrator } from "../ai/ai.factory.js";
import { buildBusinessHoursPrompt } from "../ai/business-hours.js";
import { buildSystemPrompt } from "../ai/prompt.js";
import { loadMemorySections } from "../ai/memory.service.js";
import { classifyByCaption, describeMediaKindLabel, type MediaAnalysis, type MediaKind } from "../ai/media-analysis.js";
import { decideWelcome } from "../ai/welcome.js";
import {
  advanceConversationStage,
  getRecentHistoryForAi,
  recordInboundMessage,
  recordOutboundMessage,
  isConversationUpdateStillCurrent,
  setConversationAiEnabled,
  setPaymentCheckPending,
  shouldReactivateAiAfterHandoff,
  updateConversationQualification,
} from "../conversations/conversations.service.js";
import { applyAiBooking, findContactUpcoming, loadAgendaPrompt, type ActionOutcome } from "../appointments/appointments.service.js";
import { buildClaimCorrection, describeUnbackedClaims, findUnbackedClaims, type UnbackedClaim } from "../ai/claim-guard.js";
import type { WorkingHours } from "../appointments/availability.js";
import { applyAiOrder, getContactOrderState, loadOrderPrompt } from "../orders/orders.service.js";
import { withConversationSendLock } from "../conversations/conversation-send-lock.js";
import { prisma } from "../database/client.js";
import { deleteClientMediaFile, saveClientMedia, type StoredClientMedia } from "../media/client-media.service.js";
import { buildHandoffEmail, buildMediaReceivedEmail, notifyOrganizationAdmins } from "../notifications/owner-notifications.js";
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
  /** Remplace l'attente avant la réponse (délai configuré dans l'agent). Utilisé par les tests. */
  wait?: (ms: number) => Promise<void>;
}

function waitForConfiguredDelay(startedAt: number, delaySeconds: unknown, wait?: (ms: number) => Promise<void>) {
  const remainingMs = resolveResponseDelaySeconds(delaySeconds) * 1000 - (Date.now() - startedAt);
  if (remainingMs <= 0) return Promise.resolve();
  return wait ? wait(remainingMs) : new Promise((resolve) => setTimeout(resolve, remainingMs));
}

const ANALYZABLE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
/** Entre deux emails « fichier reçu » pour la même conversation (une preuve de paiement prévient toujours). */
const MEDIA_EMAIL_THROTTLE_MS = 30 * 60_000;

interface ReceivedMedia {
  stored: StoredClientMedia | null;
  kind: MediaKind;
  summary: string | null;
  isDocument: boolean;
  aiMeta: { mediaKind: MediaKind; mediaSummary: string | null; mediaNote: string; mediaStored: boolean };
}

/** Range le fichier reçu et en demande une description (si le modèle sait lire les images). Ne lève jamais. */
async function prepareReceivedMedia(organizationId: string, message: IncomingWhatsAppMessage): Promise<ReceivedMedia> {
  const media = message.media!;
  const isDocument = media.kind === "document";

  let stored: StoredClientMedia | null = null;
  if (media.data) {
    try {
      stored = await saveClientMedia(organizationId, media.data, media.mimeType, media.fileName);
    } catch (error) {
      console.error(`❌ [org:${organizationId}] Fichier reçu non enregistré :`, error);
    }
  }

  let analysis: MediaAnalysis | null = null;
  if (media.data && ANALYZABLE_MIME_TYPES.has(media.mimeType)) {
    analysis = await getAiOrchestrator().analyzeMedia?.({ data: media.data, mimeType: media.mimeType, caption: media.caption })
      .catch(() => null) ?? null;
  }

  const kind = analysis?.kind ?? classifyByCaption(media.caption, isDocument);
  const summary = analysis?.summary || null;
  const note = media.data
    ? `[Fichier reçu : ${describeMediaKindLabel(kind, isDocument)}${summary ? ` — analyse automatique : ${summary}` : ""}. Tu ne peux pas vérifier ce fichier toi-même.]`
    : "[Fichier reçu mais non enregistré (trop volumineux ou illisible). Tu ne peux pas le vérifier toi-même.]";
  return { stored, kind, summary, isDocument, aiMeta: { mediaKind: kind, mediaSummary: summary, mediaNote: note, mediaStored: Boolean(stored) } };
}

function jidToPhone(jid: string) {
  return jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0] ?? null : null;
}

/** Prévient le propriétaire (email) et signale une preuve de paiement à vérifier. Ne lève jamais. */
async function reportReceivedMedia(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  fromJid: string;
  leadName: string | null;
  caption: string | null;
  received: ReceivedMedia;
}) {
  const { organizationId, conversationId, received } = input;
  try {
    if (received.kind === "payment_proof") await setPaymentCheckPending(conversationId, true);

    if (received.kind !== "payment_proof") {
      const recentOthers = await prisma.message.count({
        where: {
          conversationId,
          id: { not: input.messageId },
          type: { in: ["IMAGE", "DOCUMENT"] },
          direction: "INBOUND",
          createdAt: { gte: new Date(Date.now() - MEDIA_EMAIL_THROTTLE_MS) },
        },
      });
      if (recentOthers > 0) return;
    }

    void notifyOrganizationAdmins(organizationId, (organizationName) =>
      buildMediaReceivedEmail({
        organizationName,
        prospect: { name: input.leadName, phone: jidToPhone(input.fromJid) },
        kind: received.kind,
        fileLabel: describeMediaKindLabel(received.kind, received.isDocument),
        caption: input.caption,
        summary: received.summary,
      }),
    );
  } catch (error) {
    console.error(`❌ [org:${organizationId}] Signalement du fichier reçu ignoré :`, error);
  }
}

function readLeadName(leadData: unknown): string | null {
  if (!leadData || typeof leadData !== "object" || Array.isArray(leadData)) return null;
  const name = (leadData as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
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

    const received = message.media ? await prepareReceivedMedia(organizationId, message) : null;

    const { conversation, message: inboundMessage, isDuplicate } = await recordInboundMessage({
      organizationId,
      fromJid: message.fromJid,
      externalId: message.externalId,
      text: message.text,
      timestamp: message.timestamp,
      ...(received && message.media
        ? { type: message.media.kind === "image" ? ("IMAGE" as const) : ("DOCUMENT" as const), media: received.stored, aiMeta: received.aiMeta }
        : {}),
    });

    if (isDuplicate) {
      if (received?.stored) await deleteClientMediaFile(organizationId, received.stored.file).catch(() => undefined);
      return;
    }

    const replyStartedAt = Date.now();

    console.log(`📩 [org:${organizationId}] Message enregistré :`, {
      from: message.fromJid,
      text: message.text,
    });

    if (received) {
      await reportReceivedMedia({
        organizationId,
        conversationId: conversation.id,
        messageId: inboundMessage.id,
        fromJid: message.fromJid,
        leadName: readLeadName(conversation.leadData),
        caption: message.media?.caption ?? null,
        received,
      });
    }

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
      conversation.updatedAt = reactivated.updatedAt;
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

    // Message d'accueil : une seule fois, au premier échange (voir ai/welcome.ts).
    const outboundCount = await prisma.message.count({ where: { conversationId: conversation.id, direction: "OUTBOUND" } });
    const welcomeDecision = decideWelcome({ welcomeMessage: settings.welcomeMessage, outboundCount, inboundText: message.text });
    let welcomeSent = false;
    if (welcomeDecision.welcome) {
      const welcomeText = welcomeDecision.welcome;
      if (welcomeDecision.welcomeOnly) await waitForConfiguredDelay(replyStartedAt, settings.responseDelaySeconds, context.wait);
      welcomeSent = await withConversationSendLock(conversation.id, async () => {
        const stillFirst = (await prisma.message.count({ where: { conversationId: conversation.id, direction: "OUTBOUND" } })) === 0;
        if (!stillFirst || !await isConversationUpdateStillCurrent(conversation.id, conversation.updatedAt)) return false;
        await instance.sendMessage(message.fromJid, welcomeText);
        await recordOutboundMessage({ conversationId: conversation.id, text: welcomeText, author: "AI", aiMeta: { kind: "welcome" } });
        return true;
      });
      if (welcomeDecision.welcomeOnly && welcomeSent) {
        console.log(`👋 [org:${organizationId}] Message d'accueil envoyé (simple salutation).`);
        return;
      }
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
    const hoursSection = buildBusinessHoursPrompt(
      {
        enabled: settings.businessHoursEnabled,
        timezone: settings.businessTimezone,
        hours: (settings.businessHours && typeof settings.businessHours === "object" ? settings.businessHours : {}) as WorkingHours,
        closedMessage: settings.closedMessage,
      },
      new Date(),
    );
    const memory = await loadMemorySections(organizationId, conversation.id, message.text);
    const systemPrompt = buildSystemPrompt({
      ...settings,
      knownLeadData: previousLeadData,
      products,
      agenda: agenda?.section ?? null,
      orders: orderSection,
      hoursSection,
      correctionsSection: memory.corrections,
      examplesSection: memory.examples,
      welcomeSent,
    });
    const history = await getRecentHistoryForAi(conversation.id);
    let aiReply = await getAiOrchestrator().getReply(conversation.id, systemPrompt, history);

    // Garde-fou : le modèle dit « rendez-vous confirmé / annulé », « commande enregistrée / annulée »
    // sans demander l'action au serveur, ou confirme un paiement qu'il ne peut pas voir. On compare à l'état réel
    // et on redemande UNE fois.
    let unbackedClaims: UnbackedClaim[] = [];
    let claimRetried = false;
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
        claimRetried = true;
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

    await waitForConfiguredDelay(replyStartedAt, settings.responseDelaySeconds, context.wait);

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

    const actions: Array<{ type: "booking" | "order"; result: string }> = [];
    const responseSent = await withConversationSendLock(conversation.id, async () => {
      if (!await isConversationUpdateStillCurrent(conversation.id, updatedConversation.updatedAt)) {
        return false;
      }

      let textToSend = outboundText;
      const applyOutcome = (type: "booking" | "order", outcome: ActionOutcome | null) => {
        if (!outcome) return;
        actions.push({ type, result: outcome.kind });
        if (outcome.replaceReply) {
          textToSend = outcome.replaceReply;
        } else if (outcome.appendToReply) {
          textToSend = `${textToSend}\n\n${outcome.appendToReply}`;
        }
      };

      if (agenda && aiReply.booking) {
        const leadName = typeof mergedLeadData.name === "string" ? mergedLeadData.name : null;
        applyOutcome("booking", await applyAiBooking(agenda, aiReply.booking, {
          organizationId,
          conversationId: conversation.id,
          contactJid: message.fromJid,
          contactName: leadName,
          contactPhone: jidToPhone(message.fromJid),
        }));
      }

      if (orderSection && aiReply.order) {
        const leadName = typeof mergedLeadData.name === "string" ? mergedLeadData.name : null;
        applyOutcome("order", await applyAiOrder(aiReply.order, {
          organizationId,
          conversationId: conversation.id,
          contactJid: message.fromJid,
          contactName: leadName,
          contactPhone: jidToPhone(message.fromJid),
        }));
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

      // Journal : pourquoi l'IA a répondu ainsi (affiché au propriétaire dans la conversation).
      await recordOutboundMessage({
        conversationId: conversation.id,
        text: textToSend,
        author: "AI",
        aiMeta: {
          intent: aiReply.intent,
          confidence: aiReply.confidence,
          leadScore: aiReply.leadScore,
          qualificationStatus: aiReply.qualificationStatus,
          needsHuman: aiReply.needsHuman,
          nextAction: aiReply.nextAction,
          ...(selectedProduct ? { productName: selectedProduct.name } : {}),
          imageSent: Boolean(imageUrl),
          actions,
          claimRetried,
          claimsUnresolved: unbackedClaims,
          correctionsUsed: memory.correctionIds.length,
          examplesUsed: memory.exampleCount,
          closedHours: hoursSection ? hoursSection.includes("est FERMÉE") : false,
          welcomeSent,
          answeringFile: Boolean(received),
        },
      });
      return true;
    });
    if (!responseSent) {
      console.log(`[org:${organizationId}] Réponse IA ignorée : un humain a pris le relais avant l’envoi.`);
      return;
    }

    // Étiquette de suivi (Nouveau → Intéressé → A commandé / À rappeler).
    const converted = actions.some((action) =>
      (action.type === "order" && (action.result === "create" || action.result === "already_created")) ||
      (action.type === "booking" && (action.result === "book" || action.result === "reschedule" || action.result === "already_booked")),
    );
    await advanceConversationStage(conversation.id, {
      intent: aiReply.intent,
      qualificationStatus: updatedConversation.qualificationStatus,
      leadScore: aiReply.leadScore,
      converted,
      handoff: aiReply.needsHuman,
    }).catch((error) => console.error(`❌ [org:${organizationId}] Étiquette du client non mise à jour :`, error));

    if (aiReply.needsHuman) {
      console.log(
        `🙋 [org:${organizationId}] L'IA signale qu'un humain doit prendre le relais (intent: ${aiReply.intent}).`,
      );
      await notifyHandoff({ organizationId, conversationId: conversation.id, fromJid: message.fromJid, intent: aiReply.intent, leadData: mergedLeadData });
    }
  } catch (error) {
    console.error(`❌ [org:${organizationId}] Échec du traitement du message entrant :`, error);
  }
}

/** L'IA passe la main : le client attend, le propriétaire doit le savoir tout de suite. Ne lève jamais. */
async function notifyHandoff(input: {
  organizationId: string;
  conversationId: string;
  fromJid: string;
  intent: string;
  leadData: Record<string, unknown>;
}) {
  try {
    const recent = await prisma.message.findMany({
      where: { conversationId: input.conversationId },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { author: true, content: true },
    });
    void notifyOrganizationAdmins(input.organizationId, (organizationName) =>
      buildHandoffEmail({
        organizationName,
        prospect: { name: readLeadName(input.leadData), phone: jidToPhone(input.fromJid) },
        intent: input.intent,
        recent: recent.reverse().map((message) => ({ author: message.author, text: message.content })),
        leadData: input.leadData,
      }),
    );
  } catch (error) {
    console.error(`❌ [org:${input.organizationId}] Email de prise de relais ignoré :`, error);
  }
}
