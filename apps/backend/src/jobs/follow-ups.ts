import { getAiOrchestrator } from "../ai/ai.factory.js";
import { buildBusinessHoursPrompt, isGoodTimeToFollowUp, type BusinessHoursConfig } from "../ai/business-hours.js";
import { buildFollowUpInstruction, FOLLOW_UP_SKIP, isDueForFollowUp } from "../ai/follow-up.js";
import { loadMemorySections } from "../ai/memory.service.js";
import { buildSystemPrompt } from "../ai/prompt.js";
import type { WorkingHours } from "../appointments/availability.js";
import { withConversationSendLock } from "../conversations/conversation-send-lock.js";
import { getRecentHistoryForAi, recordOutboundMessage } from "../conversations/conversations.service.js";
import { prisma } from "../database/client.js";
import { listProductsForAssistant } from "../products/products.service.js";

export interface JobDeps {
  now?: Date;
  isConnected: (organizationId: string) => boolean;
  send: (organizationId: string, jid: string, text: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

/** Une relance, puis une courte pause : pas de rafale de messages qui ferait bloquer le numéro. */
const PAUSE_BETWEEN_FOLLOW_UPS_MS = 6_000;
const MAX_FOLLOW_UPS_PER_RUN_PER_ORGANIZATION = 15;
/** Si l'IA échoue pour une conversation, on attend avant de réessayer (évite de rappeler l'IA toutes les 5 minutes). */
const RETRY_AFTER_FAILURE_MS = 60 * 60_000;
const failures = new Map<string, number>();

function businessHoursOf(settings: { businessHoursEnabled: boolean; businessHours: unknown; businessTimezone: string; closedMessage: string | null }): BusinessHoursConfig {
  return {
    enabled: settings.businessHoursEnabled,
    timezone: settings.businessTimezone,
    hours: (settings.businessHours && typeof settings.businessHours === "object" ? settings.businessHours : {}) as WorkingHours,
    closedMessage: settings.closedMessage,
  };
}

export interface FollowUpRunResult {
  sent: number;
  skipped: number;
}

/** Envoie les relances dues. Ne lève jamais : un problème sur une conversation ne bloque pas les autres. */
export async function runFollowUps(deps: JobDeps): Promise<FollowUpRunResult> {
  const now = deps.now ?? new Date();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const result: FollowUpRunResult = { sent: 0, skipped: 0 };

  const candidates = await prisma.conversation.findMany({
    where: {
      status: "OPEN",
      aiEnabled: true,
      stage: "INTERESTED",
      contact: { optedOut: false },
      organization: { platformSuspended: false, aiSettings: { is: { followUpEnabled: true, aiEnabled: true } } },
    },
    include: {
      contact: true,
      organization: { include: { aiSettings: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { direction: true, author: true, createdAt: true, aiMeta: true } },
    },
    orderBy: { updatedAt: "asc" },
    take: 300,
  });

  const sentPerOrganization = new Map<string, number>();
  for (const conversation of candidates) {
    const settings = conversation.organization.aiSettings;
    if (!settings) continue;
    const organizationId = conversation.organizationId;
    try {
      const lastMessage = conversation.messages[0] ?? null;
      const due = isDueForFollowUp(
        { stage: conversation.stage, status: conversation.status, aiEnabled: conversation.aiEnabled, followUpCount: conversation.followUpCount, optedOut: conversation.contact.optedOut, lastMessage },
        { delayHours: settings.followUpDelayHours, max: settings.followUpMax },
        now,
      );
      if (!due || !lastMessage) continue;
      if (!conversation.contact.whatsappJid.endsWith("@s.whatsapp.net")) continue;
      const hours = businessHoursOf(settings);
      if (!isGoodTimeToFollowUp(hours, now, settings.businessTimezone)) { result.skipped += 1; continue; }
      if (!deps.isConnected(organizationId)) { result.skipped += 1; continue; }
      if ((sentPerOrganization.get(organizationId) ?? 0) >= MAX_FOLLOW_UPS_PER_RUN_PER_ORGANIZATION) { result.skipped += 1; continue; }
      const failedAt = failures.get(conversation.id);
      if (failedAt && now.getTime() - failedAt < RETRY_AFTER_FAILURE_MS) { result.skipped += 1; continue; }

      const followUpNumber = conversation.followUpCount + 1;
      const lastClientMessage = await prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: "INBOUND", type: "TEXT" },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      });
      const [products, memory] = await Promise.all([
        listProductsForAssistant(organizationId),
        loadMemorySections(organizationId, conversation.id, lastClientMessage?.content ?? ""),
      ]);
      const systemPrompt = [
        buildSystemPrompt({
          ...settings,
          knownLeadData: (conversation.leadData && typeof conversation.leadData === "object" && !Array.isArray(conversation.leadData) ? conversation.leadData : {}) as Record<string, unknown>,
          products,
          hoursSection: buildBusinessHoursPrompt(hours, now),
          correctionsSection: memory.corrections,
        }),
        buildFollowUpInstruction({ hoursSinceLastMessage: (now.getTime() - lastMessage.createdAt.getTime()) / 3600_000, followUpNumber }),
      ].join("\n\n");
      const history = await getRecentHistoryForAi(conversation.id);
      const reply = await getAiOrchestrator().getReply(conversation.id, systemPrompt, history, { logRun: false });

      if (reply.intent === "erreur_traitement") {
        failures.set(conversation.id, now.getTime());
        result.skipped += 1;
        continue;
      }
      const text = reply.reply.trim();
      if (text.toUpperCase() === FOLLOW_UP_SKIP) {
        // L'IA juge qu'une relance serait déplacée : on n'insiste pas.
        await prisma.$executeRaw`UPDATE conversations SET follow_up_count = ${settings.followUpMax}, last_follow_up_at = ${now} WHERE id = ${conversation.id}`;
        result.skipped += 1;
        continue;
      }

      const sent = await withConversationSendLock(conversation.id, async () => {
        // Entre-temps, le client a peut-être répondu ou une personne a repris la main.
        const fresh = await prisma.conversation.findUnique({
          where: { id: conversation.id },
          select: { status: true, aiEnabled: true, followUpCount: true, stage: true, contact: { select: { optedOut: true } } },
        });
        const newest = await prisma.message.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
        const lastMessageNow = await prisma.message.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, select: { direction: true, author: true, createdAt: true, aiMeta: true } });
        if (
          !fresh || !newest || !lastMessageNow ||
          !isDueForFollowUp(
            { stage: fresh.stage, status: fresh.status, aiEnabled: fresh.aiEnabled, followUpCount: fresh.followUpCount, optedOut: fresh.contact.optedOut, lastMessage: lastMessageNow },
            { delayHours: settings.followUpDelayHours, max: settings.followUpMax },
            now,
          ) ||
          lastMessageNow.createdAt.getTime() !== lastMessage.createdAt.getTime()
        ) {
          return false;
        }
        await deps.send(organizationId, conversation.contact.whatsappJid, text);
        await recordOutboundMessage({ conversationId: conversation.id, text, author: "AI", aiMeta: { kind: "follow_up", number: followUpNumber } });
        await prisma.$executeRaw`UPDATE conversations SET follow_up_count = follow_up_count + 1, last_follow_up_at = ${now} WHERE id = ${conversation.id}`;
        return true;
      });
      if (sent) {
        result.sent += 1;
        sentPerOrganization.set(organizationId, (sentPerOrganization.get(organizationId) ?? 0) + 1);
        console.log(`🔔 [org:${organizationId}] Relance ${followUpNumber} envoyée.`);
        await sleep(PAUSE_BETWEEN_FOLLOW_UPS_MS);
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      failures.set(conversation.id, now.getTime());
      console.error(`❌ [org:${organizationId}] Relance ignorée pour la conversation ${conversation.id} :`, error);
      result.skipped += 1;
    }
  }
  return result;
}

/** Réservé aux tests. */
export function resetFollowUpFailuresForTests() {
  failures.clear();
}
