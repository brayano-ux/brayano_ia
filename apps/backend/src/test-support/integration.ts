import { randomUUID } from "node:crypto";
import { prisma } from "../database/client.js";
import { setAiOrchestratorForTests } from "../ai/ai.factory.js";
import type { AIReply } from "../ai/schemas.js";
import type { AIChatMessage } from "../ai/ai.types.js";
import type { IncomingWhatsAppMessage, WhatsAppConnectionStatus, WhatsAppProvider } from "../whatsapp/whatsapp.types.js";
import { processIncomingMessage } from "../whatsapp/incoming-message.js";
import { hashPassword } from "../routes/auth.route.js";

/** Les tests d'intégration ont besoin d'une vraie base PostgreSQL : INTEGRATION_DB=1 et DATABASE_URL vers une base de TEST. */
export const integrationEnabled = process.env.INTEGRATION_DB === "1";

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function createTestOrganization(name = "Salon Éclat", options: { email?: string; role?: "ADMIN" | "AGENT"; password?: string } = {}) {
  const organization = await prisma.organization.create({ data: { name } });
  const email = options.email ?? `owner-${randomUUID().slice(0, 8)}@example.com`;
  const user = await prisma.user.create({
    data: { organizationId: organization.id, email, passwordHash: options.password ? hashPassword(options.password) : "x", name: "Propriétaire", role: options.role ?? "ADMIN" },
  });
  await prisma.aiSettings.create({
    data: { organizationId: organization.id, agentName: "Assistant", systemPrompt: "Réponds poliment.", businessInfo: "Salon de coiffure à Douala.", responseDelaySeconds: 3 },
  });
  return { organization, user };
}

export interface SentMessage {
  kind: "text" | "image";
  jid: string;
  text: string;
  imageUrl?: string;
}

export class FakeWhatsApp implements WhatsAppProvider {
  sent: SentMessage[] = [];
  status: WhatsAppConnectionStatus = "CONNECTED";
  failNextSend = false;
  /** Simule une photo qui ne part pas (fichier introuvable, lien refusé…) : les `n` prochains envois d'image échouent. */
  failImages = 0;
  async connect() {}
  async disconnect() {}
  getStatus() { return this.status; }
  getQRCode() { return null; }
  async sendMessage(jid: string, text: string) {
    if (this.failNextSend) { this.failNextSend = false; throw new Error("send failed"); }
    this.sent.push({ kind: "text", jid, text });
  }
  async sendImage(jid: string, imageUrl: string, caption?: string) {
    if (this.failImages > 0) { this.failImages -= 1; throw new Error("image download failed"); }
    this.sent.push({ kind: "image", jid, text: caption ?? "", imageUrl }); }
  onMessage() {}
  onConnectionUpdate() {}
}

export function aiReply(overrides: Partial<AIReply> = {}): AIReply {
  return {
    reply: "Bonjour ! Comment puis-je vous aider ?",
    intent: "demande_information",
    confidence: 0.9,
    needsHuman: false,
    leadScore: 10,
    qualificationStatus: "not_qualified",
    nextAction: "continue",
    leadData: {},
    ...overrides,
  };
}

export interface ScriptedCall { systemPrompt: string; history: AIChatMessage[] }

/** Faux orchestrateur : renvoie les réponses dans l'ordre (ou une fonction) et garde les prompts reçus. */
export function installScriptedAi(script: Array<AIReply | ((call: ScriptedCall) => AIReply)> | ((call: ScriptedCall) => AIReply)) {
  const calls: ScriptedCall[] = [];
  let index = 0;
  setAiOrchestratorForTests({
    async getReply(_conversationId: string, systemPrompt: string, history: AIChatMessage[]) {
      const call = { systemPrompt, history };
      calls.push(call);
      if (typeof script === "function") return script(call);
      const entry = script[Math.min(index++, script.length - 1)];
      return typeof entry === "function" ? entry(call) : (entry ?? aiReply());
    },
    async transcribeAudio() { return "message vocal transcrit"; },
  });
  return calls;
}

let counter = 0;
export function inbound(jidNumber: string, text: string, extra: Partial<IncomingWhatsAppMessage> = {}): IncomingWhatsAppMessage {
  return { externalId: `TEST-${Date.now()}-${counter++}`, fromJid: `${jidNumber}@s.whatsapp.net`, text, timestamp: new Date(), ...extra };
}

export async function deliver(organizationId: string, instance: FakeWhatsApp, message: IncomingWhatsAppMessage) {
  await processIncomingMessage({ organizationId, instance, wait: async () => {} }, message);
}

export async function disconnectTestDatabase() {
  setAiOrchestratorForTests(null);
  await prisma.$disconnect();
}
