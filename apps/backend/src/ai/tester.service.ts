import { markAgentTested } from "../onboarding/onboarding.service.js";
import { loadAgendaPrompt, previewAiBooking } from "../appointments/appointments.service.js";
import { computeAutoStage, STAGE_LABELS } from "../conversations/stage.js";
import { formatAmount } from "../orders/order-logic.js";
import { loadOrderPrompt, previewAiOrder } from "../orders/orders.service.js";
import { buildProductDetailsMessage, buildProductImageCaption, resolveRequestedProductImage, resolveRequestedProductPhotos } from "../products/product-image-selection.js";
import { listProductsForAssistant } from "../products/products.service.js";
import { getOrCreateAiSettings } from "./ai-settings.service.js";
import { getAiOrchestrator } from "./ai.factory.js";
import type { AIChatMessage } from "./ai.types.js";
import { buildBusinessHoursPrompt } from "./business-hours.js";
import { buildClaimCorrection, describeUnbackedClaims, findUnbackedClaims } from "./claim-guard.js";
import { loadMemorySections } from "./memory.service.js";
import { classifyByCaption, describeMediaKindLabel, type MediaAnalysis, type MediaKind } from "./media-analysis.js";
import { buildSystemPrompt } from "./prompt.js";
import { decideWelcome } from "./welcome.js";
import type { WorkingHours } from "../appointments/availability.js";

export interface TesterSimulation {
  /** Rendez-vous fictif pris pendant ce test (permet de tester « déplacer » et « annuler »). */
  booking: { startsAt: string; endsAt: string } | null;
  /** Commande fictive enregistrée pendant ce test (permet de tester « annuler »). */
  order: { items: Array<{ quantity: number; name: string }>; total: number | null } | null;
}

export interface TesterMedia {
  kind: "image" | "document";
  /** Sans fichier : « fait comme si » le client envoyait ce type de fichier. */
  simulatedKind?: MediaKind | undefined;
  mimeType?: string | undefined;
  dataBase64?: string | undefined;
  caption?: string | undefined;
}

export interface TesterInput {
  message: string;
  history: AIChatMessage[];
  simulation?: { booking?: TesterSimulation["booking"] | undefined; order?: TesterSimulation["order"] | undefined } | undefined;
  media?: TesterMedia | undefined;
}

export type TesterEffect = { type: "booking" | "order" | "photo" | "handoff" | "welcome" | "file" | "stage" | "claim"; label: string };

const ANALYZABLE = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/**
 * Simule fidèlement ce que ferait l'assistant sur WhatsApp, SANS enregistrer de conversation, envoyer un message ni créer une commande ou un rendez-vous :
 * rendez-vous, commandes, photos, message d'accueil, horaires, passage de main.
 */
export async function simulateAssistantReply(organizationId: string, input: TesterInput, now = new Date()) {
  const settings = await getOrCreateAiSettings(organizationId);
  const effects: TesterEffect[] = [];
  const simulation: TesterSimulation = { booking: input.simulation?.booking ?? null, order: input.simulation?.order ?? null };

  // Message d'accueil (premier échange uniquement).
  const previousReplies = input.history.filter((entry) => entry.role === "assistant").length;
  const welcome = decideWelcome({ welcomeMessage: settings.welcomeMessage, outboundCount: previousReplies, inboundText: input.message });
  if (welcome.welcome) effects.push({ type: "welcome", label: "Message d'accueil envoyé en premier" });
  if (welcome.welcome && welcome.welcomeOnly) {
    return { replies: [{ type: "text" as const, text: welcome.welcome }], effects, simulation, reply: welcome.welcome, qualificationStatus: "not_qualified", leadScore: 0, leadData: {}, nextAction: "continue", productId: "", productName: null };
  }

  // Fichier « reçu » : analyse réelle si un fichier est fourni, sinon simulée.
  let userText = input.message;
  if (input.media) {
    const isDocument = input.media.kind === "document";
    let analysis: MediaAnalysis | null = null;
    if (input.media.dataBase64 && input.media.mimeType && ANALYZABLE.has(input.media.mimeType)) {
      analysis = await getAiOrchestrator().analyzeMedia?.({ data: Buffer.from(input.media.dataBase64, "base64"), mimeType: input.media.mimeType, caption: input.media.caption }).catch(() => null) ?? null;
    }
    const kind: MediaKind = analysis?.kind ?? input.media.simulatedKind ?? classifyByCaption(input.media.caption, isDocument);
    const label = describeMediaKindLabel(kind, isDocument);
    userText = input.media.caption || (isDocument ? "[Document reçu]" : "[Photo reçue]");
    userText = `${userText}\n[Fichier reçu : ${label}${analysis?.summary ? ` — analyse automatique : ${analysis.summary}` : ""}. Tu ne peux pas vérifier ce fichier toi-même.]`;
    effects.push({ type: "file", label: kind === "payment_proof" ? "Fichier reçu : preuve de paiement probable → le propriétaire serait prévenu par email et la conversation signalée « à vérifier »" : `Fichier reçu : ${label} → le propriétaire serait prévenu par email` });
  }

  const products = await listProductsForAssistant(organizationId);
  const simulatedBooking = simulation.booking ? { startsAt: new Date(simulation.booking.startsAt), endsAt: new Date(simulation.booking.endsAt) } : null;
  const agenda = await loadAgendaPrompt(organizationId, now, "simulateur", { upcoming: simulatedBooking && simulatedBooking.startsAt > now ? simulatedBooking : null }).catch(() => null);
  const orderSection = await loadOrderPrompt(organizationId, "simulateur", { latest: simulation.order }).catch(() => null);
  const hoursSection = buildBusinessHoursPrompt(
    {
      enabled: settings.businessHoursEnabled,
      timezone: settings.businessTimezone,
      hours: (settings.businessHours && typeof settings.businessHours === "object" ? settings.businessHours : {}) as WorkingHours,
      closedMessage: settings.closedMessage,
    },
    now,
  );
  const memory = await loadMemorySections(organizationId, "dashboard-test", input.message);
  const systemPrompt = buildSystemPrompt({
    ...settings,
    products,
    agenda: agenda?.section ?? null,
    orders: orderSection,
    hoursSection,
    correctionsSection: memory.corrections,
    examplesSection: memory.examples,
    welcomeSent: Boolean(welcome.welcome),
  });
  const history: AIChatMessage[] = [...input.history, { role: "user", content: userText }];
  const orchestrator = getAiOrchestrator();
  let reply = await orchestrator.getReply(`dashboard-test-${organizationId}`, systemPrompt, history, { logRun: false });

  // Même garde-fou « promesses non tenues » que sur WhatsApp.
  const orderState = { hasRecentOrder: Boolean(simulation.order), hasOpenNewOrder: Boolean(simulation.order) };
  const check = (candidate: typeof reply) =>
    findUnbackedClaims({
      reply: candidate.reply,
      agendaEnabled: Boolean(agenda),
      ordersEnabled: Boolean(orderSection),
      booking: candidate.booking ?? null,
      order: candidate.order ?? null,
      hasUpcomingAppointment: Boolean(simulatedBooking),
      ...orderState,
    });
  let unbacked = check(reply);
  if (unbacked.length) {
    const retry = await orchestrator.getReply(`dashboard-test-${organizationId}`, `${systemPrompt}\n\n${buildClaimCorrection(unbacked)}`, history, { logRun: false });
    if (retry.intent !== "erreur_traitement") {
      reply = retry;
      unbacked = check(retry);
    }
  }

  // Photos de produits.
  const requestText = input.media ? input.media.caption ?? "" : input.message;
  const photoProducts = resolveRequestedProductPhotos({ message: requestText, productId: reply.productId, productIds: reply.productIds, products });
  const legacyImageUrl = photoProducts.length ? null : resolveRequestedProductImage({ message: requestText, productId: reply.productId, products, legacyImageUrl: reply.imageUrl, configuredLegacyImageUrl: settings.agentImageUrl });
  const selectedProduct = photoProducts.length === 1 ? photoProducts[0]! : null;
  let text = selectedProduct ? buildProductDetailsMessage(reply.reply, selectedProduct) : reply.reply;

  const apply = (outcome: { appendToReply: string | null; replaceReply: string | null }) => {
    if (outcome.replaceReply) text = outcome.replaceReply;
    else if (outcome.appendToReply) text = `${text}\n\n${outcome.appendToReply}`;
  };

  let converted = false;
  if (agenda && reply.booking) {
    const preview = await previewAiBooking(agenda, reply.booking, simulatedBooking && simulatedBooking.startsAt > now ? simulatedBooking : null, now);
    apply(preview.outcome);
    if (preview.decision.kind === "book" || preview.decision.kind === "reschedule") {
      simulation.booking = { startsAt: preview.decision.startsAt.toISOString(), endsAt: preview.decision.endsAt.toISOString() };
      converted = true;
      effects.push({ type: "booking", label: `${preview.decision.kind === "book" ? "Rendez-vous qui serait réservé" : "Rendez-vous qui serait déplacé"} : ${preview.label} (le propriétaire serait prévenu par email)` });
    } else if (preview.decision.kind === "cancel") {
      simulation.booking = null;
      effects.push({ type: "booking", label: "Rendez-vous qui serait annulé (le propriétaire serait prévenu par email)" });
    } else {
      effects.push({ type: "booking", label: `Aucun rendez-vous enregistré : ${preview.decision.kind === "unavailable" ? "créneau indisponible, l'assistant propose d'autres horaires" : preview.decision.kind === "nothing_to_cancel" ? "rien à annuler" : preview.decision.kind === "already_booked" ? "déjà réservé" : "date ou heure à préciser"}` });
    }
  }
  if (orderSection && reply.order) {
    const preview = await previewAiOrder(reply.order, organizationId, simulation.order);
    apply(preview.outcome);
    if (preview.decision.kind === "create" && preview.order) {
      simulation.order = { items: preview.order.items, total: preview.order.total };
      converted = true;
      effects.push({ type: "order", label: `Commande qui serait enregistrée : ${preview.order.items.map((line) => `${line.quantity} × ${line.name}`).join(", ")}${preview.order.total !== null ? ` — ${formatAmount(preview.order.total)}` : ""}, livraison : ${preview.order.address} (le propriétaire serait prévenu par email)` });
    } else if (preview.decision.kind === "cancel") {
      simulation.order = null;
      effects.push({ type: "order", label: "Commande qui serait annulée (le propriétaire serait prévenu par email)" });
    } else {
      const reasons: Record<string, string> = { missing: "il manque une information (adresse ou nom)", unknown_product: "produit absent du catalogue", nothing_to_cancel: "aucune commande à annuler", cancel_too_late: "commande déjà confirmée : le propriétaire serait prévenu", already_created: "déjà enregistrée" };
      effects.push({ type: "order", label: `Aucune commande enregistrée : ${reasons[preview.decision.kind] ?? preview.decision.kind}` });
    }
  }
  if (unbacked.length) {
    text = `${text}\n\n${describeUnbackedClaims(unbacked)}`;
    effects.push({ type: "claim", label: "L'assistant a annoncé une action qu'il n'a pas pu faire : un avertissement est ajouté pour le client" });
  }
  if (reply.needsHuman) effects.push({ type: "handoff", label: "L'assistant passe la main : le propriétaire serait prévenu par email et l'IA se mettrait en pause pour ce client" });

  const stage = computeAutoStage("NEW", false, { intent: reply.intent, qualificationStatus: reply.qualificationStatus.toUpperCase() as "NOT_QUALIFIED" | "QUALIFYING" | "QUALIFIED", leadScore: reply.leadScore, converted, handoff: reply.needsHuman });
  if (stage !== "NEW") effects.push({ type: "stage", label: `Étiquette du client : ${STAGE_LABELS[stage]}` });
  if (photoProducts.length) effects.push({ type: "photo", label: `Photo${photoProducts.length > 1 ? "s" : ""} envoyée${photoProducts.length > 1 ? "s" : ""} : ${photoProducts.map((product) => product.name).join(", ")}` });

  const replies: Array<{ type: "text"; text: string } | { type: "image"; imageUrl: string; caption: string }> = [];
  if (welcome.welcome) replies.push({ type: "text", text: welcome.welcome });
  if (legacyImageUrl) {
    replies.push({ type: "image", imageUrl: legacyImageUrl, caption: reply.reply });
    if (text !== reply.reply) replies.push({ type: "text", text });
  } else {
    replies.push({ type: "text", text });
    for (const product of photoProducts) replies.push({ type: "image", imageUrl: product.imageUrl, caption: buildProductImageCaption(product) });
  }

  if (reply.intent !== "erreur_traitement" && text.trim()) {
    await markAgentTested(settings).catch(() => console.warn("Progression du démarrage non enregistrée ; le test reste disponible."));
  }

  return {
    replies,
    effects,
    simulation,
    // Champs historiques (anciens clients du tableau de bord).
    reply: text,
    qualificationStatus: reply.qualificationStatus,
    leadScore: reply.leadScore,
    leadData: reply.leadData,
    nextAction: reply.nextAction,
    productId: reply.productId,
    productName: products.find((product) => product.id === reply.productId)?.name ?? null,
  };
}
