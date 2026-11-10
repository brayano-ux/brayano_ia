import { getOrCreateAiSettings, resolveResponseDelaySeconds } from "../ai/ai-settings.service.js";
import { getAiOrchestrator } from "../ai/ai.factory.js";
import { buildBusinessHoursPrompt } from "../ai/business-hours.js";
import { buildNegotiationSection, buildQuotedProductSection, buildSystemPrompt, buildTopicGateSection } from "../ai/prompt.js";
import {
  buildNegotiationInstruction,
  isNegotiationState,
  nextNegotiationOffer,
  startNegotiation,
} from "../ai/price-negotiation.js";
import { parsePriceAmount } from "../products/price-parsing.js";
import { loadMemorySections } from "../ai/memory.service.js";
import { classifyByCaption, describeMediaKindLabel, type MediaAnalysis, type MediaKind } from "../ai/media-analysis.js";
import { decideWelcome, placeWelcomeBeforeClientMessages } from "../ai/welcome.js";
import { isOptOutRequest, OPT_OUT_CONFIRMATION } from "../ai/opt-out.js";
import { setContactOptOut } from "../contacts/contacts.service.js";
import { isIgnoredNumber } from "../contacts/ignored-contacts.service.js";
import { isLocationRequested } from "./location-request.js";
import {
  advanceConversationStage,
  getRecentHistoryForAi,
  openTopicGate,
  recordInboundMessage,
  recordOutboundMessage,
  isConversationUpdateStillCurrent,
  setConversationAiEnabled,
  setConversationNegotiationState,
  setPaymentCheckPending,
  shouldReactivateAiAfterHandoff,
  updateConversationQualification,
} from "../conversations/conversations.service.js";
import { applyAiBooking, findContactUpcoming, loadAgendaPrompt, type ActionOutcome } from "../appointments/appointments.service.js";
import { buildClaimCorrection, describeUnbackedClaims, findUnbackedClaims, type UnbackedClaim } from "../ai/claim-guard.js";
import type { WorkingHours } from "../appointments/availability.js";
import { applyAiOrder, getContactOrderState, loadOrderPrompt } from "../orders/orders.service.js";
import { withConversationReplyQueue, withConversationSendLock } from "../conversations/conversation-send-lock.js";
import { prisma } from "../database/client.js";
import { deleteClientMediaFile, saveClientMedia, type StoredClientMedia } from "../media/client-media.service.js";
import { buildAiUnavailableEmail, buildHandoffEmail, buildMediaReceivedEmail, notifyOrganizationAdmins } from "../notifications/owner-notifications.js";
import { getPlatformSuspension } from "../organizations/platform-suspension.service.js";
import { notifyQuotaReached, notifyTrialLowCredits, releaseAiResponse, reserveAiResponse, type AiResponseEntitlement } from "../billing/subscription.service.js";
import { registerQualifiedLead } from "../lead-routing/lead-routing.service.js";
import {
  buildProductDetailsMessage,
  buildProductImageCaption,
  resolveRequestedProductPhotos,
} from "../products/product-image-selection.js";
import { buildCatalogIndexSection, CATALOG_DETAILED_LIMIT, selectCatalogForPrompt } from "../products/catalog-search.js";
import { listProductsForAssistant } from "../products/products.service.js";
import { findLatestSentProductId, findProductIdForSentImage, findRecentSentProductIds, recordSentProductImage } from "../products/sent-product-images.service.js";
import { createTypingSession, EARLY_TYPING_MAX_DELAY_SECONDS, planReplyPacing, sendInBubbles, type TypingSession } from "./human-pacing.js";
import {
  buildGroupedMessagesSection,
  carryWelcomeOver,
  clearPendingGroup,
  groupingWindowMs,
  isLatestInbound,
  pendingGroup,
  registerPendingInbound,
  takeCarriedWelcome,
  type PendingInbound,
} from "./message-grouping.js";
import type { IncomingWhatsAppMessage, WhatsAppProvider } from "./whatsapp.types.js";

export interface IncomingMessageContext {
  organizationId: string;
  instance: WhatsAppProvider;
  /** Remplace l'attente avant la réponse (délai configuré dans l'agent). Utilisé par les tests. */
  wait?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Dernière attente avant d'envoyer `replyText` (voir planReplyPacing) : ce qu'il reste du délai configuré et du
 * temps de frappe, en tenant compte de ce que le client a déjà vu. « En train d'écrire… » est toujours visible
 * juste avant l'envoi : s'il n'était pas encore affiché (délai long, message d'accueil), il l'est ici.
 */
async function waitBeforeSending(input: {
  startedAt: number;
  delaySeconds: unknown;
  replyText: string;
  typing: TypingSession;
  wait: ((ms: number) => Promise<void>) | undefined;
}, random: () => number = Math.random) {
  const plan = planReplyPacing(
    { configuredDelaySeconds: resolveResponseDelaySeconds(input.delaySeconds), replyText: input.replyText, elapsedMs: Date.now() - input.startedAt, typingVisibleMs: input.typing.visibleMs() },
    random,
  );
  const sleep = input.wait ?? realSleep;
  if (plan.silentMs > 0) await sleep(plan.silentMs);
  if (plan.typingMs > 0) {
    input.typing.start();
    await sleep(plan.typingMs);
  }
}

/** Délai de réponse configuré pour cette entreprise, lu avant toute décision (sert à doser le silence de regroupement). */
async function loadResponseDelaySeconds(organizationId: string): Promise<number> {
  const settings = await prisma.aiSettings.findUnique({ where: { organizationId }, select: { responseDelaySeconds: true } }).catch(() => null);
  return resolveResponseDelaySeconds(settings?.responseDelaySeconds);
}

/** Dernier avis « IA indisponible » envoyé par entreprise : au plus un email par heure, quel que soit le nombre de clients touchés. */
const aiUnavailableNoticeAt = new Map<string, number>();
const AI_UNAVAILABLE_NOTICE_EVERY_MS = 60 * 60_000;

/**
 * Aucun fournisseur IA n'a répondu. On ne passe PAS la main (l'assistant réessaiera au message suivant) : on envoie un
 * court message d'attente au client, une seule fois d'affilée pour ne pas l'inonder, et on prévient le propriétaire au
 * plus une fois par heure. Ne lève jamais.
 */
async function handleAiUnavailable(input: {
  organizationId: string;
  conversationId: string;
  contactJid: string;
  instance: WhatsAppProvider;
  fallbackText: string;
  wait: ((ms: number) => Promise<void>) | undefined;
}) {
  try {
    const lastOutbound = await prisma.message.findFirst({
      where: { conversationId: input.conversationId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
      select: { aiMeta: true },
    });
    const alreadyWaiting = (lastOutbound?.aiMeta as { kind?: unknown } | null)?.kind === "ai_unavailable";
    if (!alreadyWaiting) {
      await sendInBubbles(input.instance, input.contactJid, input.fallbackText, { wait: input.wait });
      await recordOutboundMessage({ conversationId: input.conversationId, text: input.fallbackText, author: "AI", aiMeta: { kind: "ai_unavailable" } });
    }
    const now = Date.now();
    const lastNotice = aiUnavailableNoticeAt.get(input.organizationId) ?? 0;
    if (now - lastNotice >= AI_UNAVAILABLE_NOTICE_EVERY_MS) {
      aiUnavailableNoticeAt.set(input.organizationId, now);
      void notifyOrganizationAdmins(input.organizationId, (organizationName) =>
        buildAiUnavailableEmail({ organizationName, contactLabel: `+${jidToPhone(input.contactJid)}`, detail: null }));
    }
    console.error(`❌ [org:${input.organizationId}] IA indisponible : message d'attente ${alreadyWaiting ? "déjà envoyé" : "envoyé"}, l'assistant réessaiera au prochain message.`);
  } catch (error) {
    console.error(`❌ [org:${input.organizationId}] Traitement de l'indisponibilité IA impossible :`, error);
  }
}

/** Réservé aux tests : oublie les avis « IA indisponible » déjà envoyés. */
export function resetAiUnavailableNoticesForTests() {
  aiUnavailableNoticeAt.clear();
}

/** Coches bleues sur les messages du client dès qu'on sait qu'on va lui répondre : un humain lit, puis écrit. Ne lève jamais. */
function markAsRead(instance: Pick<WhatsAppProvider, "markAsRead">, jid: string, messageIds: string[]) {
  return instance.markAsRead?.(jid, messageIds).catch(() => undefined) ?? Promise.resolve();
}

const ANALYZABLE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);

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

/** Message honnête envoyé au client quand une photo n'a pas pu partir (le propriétaire le voit dans le journal). */
export function describeUnsentPhotos(productNames: string[]): string {
  const plural = productNames.length > 1;
  const detail = productNames.length ? ` (${productNames.join(", ")})` : "";
  return `📷 Je n'arrive pas à envoyer ${plural ? "les photos" : "la photo"}${detail} pour le moment. Notre équipe ${plural ? "vous les" : "vous la"} transmettra dès que possible.`;
}

function jidToPhone(jid: string) {
  return jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0] ?? null : null;
}

/** Prévient le propriétaire (email) et signale une preuve de paiement à vérifier. Ne lève jamais. */
async function reportReceivedMedia(input: {
  organizationId: string;
  conversationId: string;
  fromJid: string;
  leadName: string | null;
  caption: string | null;
  received: ReceivedMedia;
}) {
  const { organizationId, conversationId, received } = input;
  try {
    // Seule une preuve de paiement prévient le propriétaire par email (il doit vérifier son solde avant de
    // livrer) : une photo de produit, un document ou un autre fichier reste visible dans la conversation,
    // sans email.
    if (received.kind !== "payment_proof") return;

    await setPaymentCheckPending(conversationId, true);

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
 * Reçoit UN message d'un contact : transcription, enregistrement, cas sans réponse de l'IA (doublon, numéro
 * ignoré, « STOP »). Puis attend un court silence : si le client enchaîne plusieurs messages, seul le dernier
 * déclenche la réponse, qui porte sur tout le groupe (voir message-grouping.ts et replyToPendingMessages).
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
      ...(message.startedFromAd ? { startedFromAd: true } : {}),
    });

    if (isDuplicate) {
      if (received?.stored) await deleteClientMediaFile(organizationId, received.stored.file).catch(() => undefined);
      return;
    }

    const replyStartedAt = Date.now();

    // Pas de contenu de message ni de numéro dans les journaux : ce sont des données de vos clients.
    console.log(`📩 [org:${organizationId}] Message enregistré (${message.text.length} caractères).`);

    // Numéro ignoré (famille, fournisseur…) : le message reste visible dans la boîte de réception, mais l'IA ne répond jamais et le propriétaire n'est pas notifié.
    if (await isIgnoredNumber(organizationId, message.fromJid)) {
      console.log(`🙈 [org:${organizationId}] Numéro ignoré : aucune réponse automatique.`);
      return;
    }

    if (received) {
      await reportReceivedMedia({
        organizationId,
        conversationId: conversation.id,
        fromJid: message.fromJid,
        leadName: readLeadName(conversation.leadData),
        caption: message.media?.caption ?? null,
        received,
      });
    }

    // « STOP » : plus de relances ni de messages groupés pour ce contact (il peut toujours écrire et obtenir une réponse).
    if (!message.media && isOptOutRequest(message.text)) {
      await setContactOptOut(organizationId, conversation.contactId, true);
      console.log(`🔕 [org:${organizationId}] Le contact demande à ne plus recevoir de relances.`);
      if (conversation.aiEnabled && conversation.status === "OPEN") {
        await withConversationSendLock(conversation.id, async () => {
          await instance.sendMessage(message.fromJid, OPT_OUT_CONFIRMATION);
          await recordOutboundMessage({ conversationId: conversation.id, text: OPT_OUT_CONFIRMATION, author: "AI", aiMeta: { kind: "opt_out" } });
        });
      }
      return;
    }

    registerPendingInbound(conversation.id, {
      externalId: message.externalId,
      text: message.text,
      requestText: message.media ? message.media.caption ?? "" : message.text,
      quotedMessageId: message.quotedMessageId,
      hasMedia: Boolean(received),
    });
    // Le client écrit peut-être encore : on lui laisse un court instant avant de répondre, dosé d'après le délai
    // configuré (cette attente s'ajoute au temps de réponse de l'IA).
    await (context.wait ?? realSleep)(groupingWindowMs(await loadResponseDelaySeconds(organizationId)));
    if (!isLatestInbound(conversation.id, message.externalId)) {
      console.log(`🧩 [org:${organizationId}] Message suivi d'un autre : une seule réponse sera envoyée pour le groupe.`);
      return;
    }
    await withConversationReplyQueue(conversation.id, () => replyToPendingMessages(context, message, conversation.id, replyStartedAt));
  } catch (error) {
    console.error(`❌ [org:${organizationId}] Échec du traitement du message entrant :`, error);
  }
}

/**
 * Répond aux messages du client restés sans réponse (un seul, ou plusieurs envoyés à la suite) : décision (IA
 * active ? suspendue ? forfait ?), réponse de l'IA, actions (rendez-vous, commande), envoi et enregistrement.
 * Appelée dans la file de réponse de la conversation : une seule réponse en préparation à la fois.
 * `message` est le dernier message du groupe. Ne lève jamais.
 */
async function replyToPendingMessages(context: IncomingMessageContext, message: IncomingWhatsAppMessage, conversationId: string, replyStartedAt: number): Promise<void> {
  const { organizationId, instance } = context;
  // Message de l'assistant réservé dans le forfait : rendu (finally) si la réponse n'est finalement pas partie.
  let reservation: Extract<AiResponseEntitlement, { allowed: true }> | null = null;
  let replyDelivered = false;
  // Un message plus récent est arrivé : il portera la réponse, les messages en attente lui sont laissés.
  let superseded = false;
  let group: PendingInbound[] = [];
  // « En train d'écrire… » affiché dès que l'agent sait qu'il va répondre, et maintenu pendant l'appel à l'IA.
  const typing = createTypingSession(instance, message.fromJid, { keepAlive: !context.wait });
  try {
    if (!isLatestInbound(conversationId, message.externalId)) {
      superseded = true;
      return;
    }
    // Relue ici : la réponse précédente a pu changer l'état de la conversation pendant l'attente dans la file.
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return;
    group = pendingGroup(conversationId);
    const groupIds = group.map((entry) => entry.externalId);
    const groupText = group.map((entry) => entry.text).filter(Boolean).join("\n");
    const answeringFile = group.some((entry) => entry.hasMedia);

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

    // Publicité uniquement : le client n'a pas démarré la conversation en cliquant sur une publicité
    // Facebook/Instagram « Cliquer pour WhatsApp ». Message gardé dans la boîte de réception, aucune réponse.
    if (settings.adOnlyEnabled && !conversation.startedFromAd) {
      console.log(`📢 [org:${organizationId}] Conversation non issue d'une publicité : aucune réponse automatique.`);
      return;
    }

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
    const welcomeDecision = decideWelcome({ welcomeMessage: settings.welcomeMessage, outboundCount, inboundText: groupText });
    // Accueil parti juste avant une réponse abandonnée au profit de ce message : inutile de saluer à nouveau.
    const carriedWelcome = takeCarriedWelcome(conversation.id);
    const sentWelcomeText = welcomeDecision.welcome ?? carriedWelcome;
    let welcomeSent = Boolean(carriedWelcome);
    if (welcomeDecision.welcome) {
      const welcomeText = welcomeDecision.welcome;
      await markAsRead(instance, message.fromJid, groupIds);
      if (welcomeDecision.welcomeOnly) await waitBeforeSending({ startedAt: replyStartedAt, delaySeconds: settings.responseDelaySeconds, replyText: welcomeText, typing, wait: context.wait });
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

    // Forfait : un message de l'assistant est compté avant d'appeler l'IA. Sans forfait valable (quand les forfaits sont
    // appliqués), l'assistant se tait, le message du client reste dans la boîte et le propriétaire est prévenu.
    const entitlement = await reserveAiResponse(organizationId);
    if (!entitlement.allowed) {
      console.log(`💸 [org:${organizationId}] L'assistant ne répond pas (${entitlement.reason}) : le propriétaire est prévenu.`);
      void notifyQuotaReached(organizationId, entitlement.reason);
      return;
    }
    reservation = entitlement;
    if (entitlement.source === "trial") void notifyTrialLowCredits(organizationId, entitlement.remaining);
    // On va répondre : le message passe en « lu » tout de suite, la réponse arrive après le délai de frappe.
    await markAsRead(instance, message.fromJid, groupIds);
    // Sujet autorisé : tant que le client n'a pas encore écrit dessus, l'IA classe le message sans qu'on l'envoie.
    // Une fois ouvert pour cette conversation, elle reste ouverte pour toujours : plus besoin de reclasser.
    const topicGateActive = Boolean(settings.topicGateEnabled && settings.topicGateTopic?.trim() && !conversation.topicGateOpened);
    // Lu, puis « en train d'écrire… » tout de suite : le client voit l'agent travailler pendant que l'IA répond.
    // Pas avec un délai long (l'agent écrira juste avant d'envoyer), ni tant qu'on ne sait pas si on répondra.
    if (!topicGateActive && resolveResponseDelaySeconds(settings.responseDelaySeconds) <= EARLY_TYPING_MAX_DELAY_SECONDS) typing.start();

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
    const memory = await loadMemorySections(organizationId, conversation.id, groupText);

    // Le client répond directement à une photo de produit envoyée plus tôt : on dit à l'IA de quel produit il s'agit,
    // sans attendre qu'il le nomme (voir products/sent-product-images.service.ts).
    let quotedProductSection: string | null = null;
    let quotedProductId: string | null = null;
    const quotedMessageId = [...group].reverse().find((entry) => entry.quotedMessageId)?.quotedMessageId;
    if (quotedMessageId) {
      try {
        quotedProductId = await findProductIdForSentImage(quotedMessageId);
        const quotedProduct = quotedProductId ? products.find((product) => product.id === quotedProductId) : null;
        if (quotedProduct) quotedProductSection = buildQuotedProductSection(quotedProduct);
      } catch (error) {
        console.error(`❌ [org:${organizationId}] Résolution de la photo citée ignorée :`, error);
      }
    }

    const recentHistory = await getRecentHistoryForAi(conversation.id);
    // Grand catalogue : seules les fiches utiles à cette conversation partent en détail, le reste en index compact.
    const largeCatalog = products.length > CATALOG_DETAILED_LIMIT;
    const recentSentProductIds = largeCatalog ? await findRecentSentProductIds(conversation.id).catch(() => [] as string[]) : [];
    const catalog = selectCatalogForPrompt(products, {
      queries: [{ text: groupText, weight: 3 }, ...recentHistory.slice(-6).map((turn) => ({ text: turn.content, weight: 1 }))],
      pinnedIds: [quotedProductId, ...recentSentProductIds, isNegotiationState(conversation.negotiationState) ? conversation.negotiationState.productId : null],
    });

    const systemPrompt = buildSystemPrompt({
      ...settings,
      knownLeadData: previousLeadData,
      products: catalog.detailed,
      catalogIndexSection: buildCatalogIndexSection(catalog.others),
      groupedMessagesSection: buildGroupedMessagesSection(group.length),
      agenda: agenda?.section ?? null,
      orders: orderSection,
      hoursSection,
      correctionsSection: memory.corrections,
      examplesSection: memory.examples,
      welcomeSent,
      topicGateSection: topicGateActive ? buildTopicGateSection(settings.topicGateTopic!.trim()) : null,
      negotiationSection: settings.negotiationEnabled ? buildNegotiationSection() : null,
      quotedProductSection,
    });
    const history = welcomeSent && sentWelcomeText ? placeWelcomeBeforeClientMessages(recentHistory, sentWelcomeText) : recentHistory;
    let aiReply = await getAiOrchestrator().getReply(conversation.id, systemPrompt, history);

    // Le client a écrit de nouveau pendant que l'IA préparait sa réponse : on abandonne celle-ci (rien n'a encore
    // été modifié ni envoyé, le message du forfait est rendu) et le message le plus récent répondra à l'ensemble.
    if (!isLatestInbound(conversation.id, message.externalId)) {
      superseded = true;
      if (welcomeSent && sentWelcomeText) carryWelcomeOver(conversation.id, sentWelcomeText);
      console.log(`🧩 [org:${organizationId}] Nouveau message reçu pendant la préparation : la réponse portera sur l'ensemble.`);
      return;
    }

    // Panne de l'IA (tous les fournisseurs en échec) : pas de passage de main, pas de décompte dans le forfait
    // (reservation rendue dans le finally), un message d'attente et un avis au propriétaire.
    if (aiReply.intent === "erreur_traitement") {
      await handleAiUnavailable({ organizationId, conversationId: conversation.id, contactJid: message.fromJid, instance, fallbackText: aiReply.reply, wait: context.wait });
      return;
    }

    if (topicGateActive) {
      if (aiReply.onTopic) {
        await openTopicGate(conversation.id);
      } else {
        console.log(`🔒 [org:${organizationId}] Message hors du sujet autorisé (« ${settings.topicGateTopic} ») : pas de réponse envoyée.`);
        return;
      }
    }

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

    // Négociation de prix : le client marchande, le CODE calcule le prix exact (jamais l'IA), par palier
    // dégressif jusqu'au plancher configuré ; on redemande ensuite à l'IA de le présenter naturellement.
    // L'article concerné est, dans l'ordre : celui que l'IA dit être en discussion dans CE message, celui dont
    // le client demande la photo, celui dont il cite la photo, le dernier dont une photo lui a été envoyée, et
    // seulement en dernier recours celui d'une négociation déjà ouverte. Un changement d'article repart de son
    // propre prix : jamais le prix réduit de l'article précédent.
    const discountRequested = Boolean(aiReply.wantsDiscount);
    let negotiationInfo: { productName: string; price: number; round: number; isFinal: boolean } | null = null;
    if (settings.negotiationEnabled && discountRequested) {
      try {
        const existingNegotiation = isNegotiationState(conversation.negotiationState) ? conversation.negotiationState : null;
        const latestSentProductId = aiReply.discussedProductId || aiReply.productId || quotedProductId ? null : await findLatestSentProductId(conversation.id).catch(() => null);
        const candidates = [aiReply.discussedProductId, aiReply.productId, quotedProductId, latestSentProductId, existingNegotiation?.productId];
        const negotiationProductId = candidates.find((candidate): candidate is string => Boolean(candidate)) ?? null;
        const negotiationProduct = negotiationProductId ? products.find((item) => item.id === negotiationProductId) : null;
        const basePrice = negotiationProduct ? parsePriceAmount(negotiationProduct.price) : null;
        if (negotiationProduct && basePrice) {
          const baseState = existingNegotiation && existingNegotiation.productId === negotiationProduct.id
            ? existingNegotiation
            : startNegotiation(negotiationProduct.id, basePrice, settings.negotiationMaxDiscountPercent ?? 10);
          const { price: negotiatedPrice, state: nextNegotiationState, isFinal: negotiationFinal } = nextNegotiationOffer(baseState);
          await setConversationNegotiationState(conversation.id, nextNegotiationState as object);
          const retry = await getAiOrchestrator().getReply(
            conversation.id,
            `${systemPrompt}\n\n${buildNegotiationInstruction(negotiatedPrice, negotiationFinal, negotiationProduct.name)}`,
            history,
          );
          if (retry.intent !== "erreur_traitement") {
            aiReply = retry;
          }
          negotiationInfo = { productName: negotiationProduct.name, price: negotiatedPrice, round: nextNegotiationState.round, isFinal: negotiationFinal };
        } else {
          console.log(`[org:${organizationId}] Remise demandée mais article non identifié : aucun prix réduit calculé.`);
        }
      } catch (error) {
        console.error(`❌ [org:${organizationId}] Négociation de prix ignorée :`, error);
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

    await waitBeforeSending({ startedAt: replyStartedAt, delaySeconds: settings.responseDelaySeconds, replyText: aiReply.reply, typing, wait: context.wait });

    // Photos demandées par le client : produits du catalogue uniquement (jamais une URL inventée par le modèle).
    // Une photo REÇUE du client ([Photo reçue]) n'est pas une demande de photo.
    const requestText = group.map((entry) => entry.requestText).filter(Boolean).join("\n");
    const discussedProduct = products.find((product) => product.id === (aiReply.discussedProductId || aiReply.productId)) ?? null;
    const photoProducts = resolveRequestedProductPhotos({ message: requestText, productId: aiReply.productId, productIds: aiReply.productIds, products });
    const locationRequested = settings.shopLatitude != null && settings.shopLongitude != null && isLocationRequested(requestText);

    const selectedProduct = photoProducts.length === 1 ? photoProducts[0]! : null;
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

      // Une photo qui ne part pas ne doit jamais laisser le client sans réponse : le texte part toujours,
      // et on prévient honnêtement le client si une photo manque.
      let imagesFailed = 0;
      const sentProductNames: string[] = [];
      // Une longue réponse part en deux ou trois bulles, comme une personne qui écrit depuis son téléphone
      // (voir human-pacing.ts). Le journal garde le texte complet en un seul message.
      let bubbles = 1;
      if (photoProducts.length) {
        bubbles = await sendInBubbles(instance, message.fromJid, textToSend, { wait: context.wait });
        const failedNames: string[] = [];
        for (const product of photoProducts) {
          try {
            const sentImageId = await instance.sendImage(message.fromJid, product.imageUrl, buildProductImageCaption(product));
            sentProductNames.push(product.name);
            await recordSentProductImage(conversation.id, product.id, sentImageId).catch((error) => {
              console.error(`❌ [org:${organizationId}] Association photo → produit non enregistrée :`, error);
            });
          } catch (error) {
            console.error(`❌ [org:${organizationId}] Photo du produit « ${product.name} » non envoyée :`, error instanceof Error ? error.message : error);
            failedNames.push(product.name);
          }
        }
        imagesFailed = failedNames.length;
        if (failedNames.length) {
          await instance.sendMessage(message.fromJid, describeUnsentPhotos(failedNames));
        }
      } else {
        bubbles = await sendInBubbles(instance, message.fromJid, textToSend, { wait: context.wait });
      }

      // Le client demande où se trouve la boutique / comment y aller : on envoie le point GPS configuré par le propriétaire.
      let locationSent = false;
      if (locationRequested) {
        try {
          await instance.sendLocation(message.fromJid, settings.shopLatitude!, settings.shopLongitude!, settings.shopLocationLabel ?? settings.agentName);
          locationSent = true;
        } catch (error) {
          console.error(`❌ [org:${organizationId}] Localisation de la boutique non envoyée :`, error instanceof Error ? error.message : error);
        }
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
          ...(sentProductNames.length ? { productNames: sentProductNames } : {}),
          imageSent: Boolean(photoProducts.length),
          photosSent: photoProducts.length - imagesFailed,
          ...(bubbles > 1 ? { bubbles } : {}),
          ...(imagesFailed ? { imagesFailed } : {}),
          ...(locationRequested ? { locationSent } : {}),
          actions,
          ...(discountRequested ? { negotiationRequested: true } : {}),
          ...(negotiationInfo ? { negotiation: negotiationInfo } : {}),
          claimRetried,
          claimsUnresolved: unbackedClaims,
          correctionsUsed: memory.correctionIds.length,
          examplesUsed: memory.exampleCount,
          closedHours: hoursSection ? hoursSection.includes("est FERMÉE") : false,
          welcomeSent,
          answeringFile,
          ...(group.length > 1 ? { groupedMessages: group.length } : {}),
          // Pour les statistiques : article dont parlait le client, et information qui a manqué à l'assistant.
          ...(discussedProduct ? { discussedProductId: discussedProduct.id, discussedProductName: discussedProduct.name } : {}),
          ...(aiReply.missingInfo ? { missingInfo: aiReply.missingInfo } : {}),
        },
      });
      return true;
    });
    if (!responseSent) {
      console.log(`[org:${organizationId}] Réponse IA ignorée : un humain a pris le relais avant l’envoi.`);
      return;
    }
    // Une réponse d'excuse de l'IA en panne ne compte pas dans le forfait.
    replyDelivered = aiReply.intent !== "erreur_traitement";

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
    console.error(`❌ [org:${organizationId}] Échec de la réponse au message entrant :`, error);
  } finally {
    if (reservation && !replyDelivered) {
      await releaseAiResponse(organizationId, reservation).catch((error) => console.error(`❌ [org:${organizationId}] Message du forfait non rendu :`, error));
    }
    typing.stop();
    // L'agent a commencé à écrire puis ne répond finalement pas (hors sujet, prise de main humaine…) : on retire
    // l'indicateur. Si un message plus récent prend le relais, il continue d'écrire.
    if (typing.visibleMs() > 0 && !replyDelivered && !superseded) await instance.stopTypingIndicator?.(message.fromJid).catch(() => undefined);
    // Groupe traité (réponse envoyée ou décision de ne pas répondre) : ces messages n'attendent plus rien.
    if (!superseded) clearPendingGroup(conversationId, group.map((entry) => entry.externalId));
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
