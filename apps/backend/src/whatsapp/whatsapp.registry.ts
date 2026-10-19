import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { recordHumanReplyFromPhone } from "../conversations/conversations.service.js";
import { prisma } from "../database/client.js";
import {
  sendClientDisconnectEmail,
  sendClientRecoveredEmail,
  sendWhatsAppDisconnectAlert,
  sendWhatsAppRecoveredNotice,
} from "../notifications/whatsapp-alerts.js";
import { BaileysWhatsAppProvider } from "./baileys.provider.js";
import { processIncomingMessage } from "./incoming-message.js";
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

  instance.onMessage((message: IncomingWhatsAppMessage) => processIncomingMessage({ organizationId, instance }, message));

  return instance;
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

/** Réservé aux tests et aux démonstrations locales : branche un faux numéro WhatsApp sur une entreprise. */
export function registerWhatsAppProviderForTests(organizationId: string, provider: WhatsAppProvider): void {
  providers.set(organizationId, provider);
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
