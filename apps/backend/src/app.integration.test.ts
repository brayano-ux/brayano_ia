import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  process.env.CLIENT_MEDIA_DIR = `/tmp/brayano-test-app-media-${process.pid}`;
  process.env.PLATFORM_ADMIN_TOKEN = "admin-token-admin-token-admin-token-0123";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_USER = "user@example.com";
  process.env.SMTP_PASSWORD = "secret";
  process.env.SMTP_FROM = "noreply@example.com";
  return { sent: [] as Array<{ organizationId: string; jid: string; text: string }>, connected: true };
});

vi.mock("./whatsapp/whatsapp.registry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./whatsapp/whatsapp.registry.js")>();
  return {
    ...original,
    sendWhatsAppMessageForOrg: async (organizationId: string, jid: string, text: string) => { hoisted.sent.push({ organizationId, jid, text }); },
    getWhatsAppAccountStatus: () => (hoisted.connected ? "CONNECTED" : "DISCONNECTED"),
  };
});

vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: async () => ({}) }) } }));

import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./app.js";
import { setBillingEnforcedForTests } from "./billing/subscription.service.js";
import { resetSupportRateLimitForTests, setSupportProvidersForTests } from "./support-assistant/support-assistant.js";
import { prisma } from "./database/client.js";
import { saveClientMedia } from "./media/client-media.service.js";
import { hashPassword } from "./routes/auth.route.js";
import { resetRateLimitsForTests } from "./auth/rate-limit.js";
import { createTestOrganization, disconnectTestDatabase, integrationEnabled, resetDatabase } from "./test-support/integration.js";

const PASSWORD = "motdepasse123";

describe.skipIf(!integrationEnabled)("API complète (HTTP, base réelle)", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildServer({ restoreConnections: false }); });
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
    rmSync(process.env.CLIENT_MEDIA_DIR!, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetDatabase();
    hoisted.sent.length = 0;
    hoisted.connected = true;
  });

  let loginCounter = 0;
  async function login(email: string, password = PASSWORD) {
    // La connexion est limitée à 5 essais par minute et par adresse : chaque connexion de test vient d'une « adresse » différente.
    loginCounter += 1;
    const response = await app.inject({ method: "POST", url: "/login", headers: { "x-forwarded-for": `10.0.0.${loginCounter}` }, payload: { email, password } });
    return { response, token: response.json().token as string | undefined };
  }
  const authed = (token: string | undefined) => ({ authorization: `Bearer ${token}` });

  async function setup() {
    const { organization, user } = await createTestOrganization("Salon Éclat", { email: "owner@example.com", password: PASSWORD });
    const { token } = await login("owner@example.com");
    return { organization, user, token: token! };
  }

  it("refuse l'accès sans connexion", async () => {
    const { organization } = await setup();
    expect((await app.inject({ method: "GET", url: `/organizations/${organization.id}/conversations` })).statusCode).toBe(401);
  });

  it("isole les entreprises : on ne lit jamais les données d'une autre", async () => {
    const mine = await setup();
    const other = await createTestOrganization("Autre", { email: "other@example.com", password: PASSWORD });
    const { token: otherToken } = await login("other@example.com");
    void mine;
    const response = await app.inject({ method: "GET", url: `/organizations/${mine.organization.id}/conversations`, headers: authed(otherToken) });
    expect(response.statusCode).toBe(403);
    void other;
  });

  describe("équipe et droits", () => {
    async function addAgent(ownerToken: string, organizationId: string, email = "fatou@example.com") {
      return app.inject({ method: "POST", url: `/organizations/${organizationId}/team`, headers: authed(ownerToken), payload: { name: "Fatou", email, password: PASSWORD } });
    }

    it("le propriétaire ajoute un employé qui se connecte et voit la boîte de réception, mais pas la configuration", async () => {
      const { organization, token } = await setup();
      const added = await addAgent(token, organization.id);
      expect(added.statusCode).toBe(200);
      expect(added.json().member).toMatchObject({ name: "Fatou", email: "fatou@example.com", role: "AGENT", active: true });
      expect(JSON.stringify(added.json())).not.toContain("passwordHash");

      const { token: agentToken, response } = await login("fatou@example.com");
      expect(response.statusCode).toBe(200);
      const me = await app.inject({ method: "GET", url: "/me", headers: authed(agentToken) });
      expect(me.json().user).toMatchObject({ email: "fatou@example.com", name: "Fatou", role: "AGENT" });

      const base = `/organizations/${organization.id}`;
      expect((await app.inject({ method: "GET", url: `${base}/conversations`, headers: authed(agentToken) })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `${base}/orders`, headers: authed(agentToken) })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `${base}/stats?days=7`, headers: authed(agentToken) })).statusCode).toBe(200);
      for (const [method, url] of [["PUT", `${base}/ai-settings`], ["GET", `${base}/team`], ["POST", `${base}/broadcasts`], ["POST", `${base}/whatsapp/disconnect`], ["POST", `${base}/products`]] as const) {
        const denied = await app.inject({ method, url, headers: authed(agentToken), payload: {} });
        expect(denied.statusCode, `${method} ${url}`).toBe(403);
      }
    });

    it("garde qui a répondu au client", async () => {
      const { organization, token } = await setup();
      await addAgent(token, organization.id);
      const { token: agentToken } = await login("fatou@example.com");
      const contact = await prisma.contact.create({ data: { organizationId: organization.id, whatsappJid: "237655000001@s.whatsapp.net" } });
      const conversation = await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id } });

      const reply = await app.inject({ method: "POST", url: `/organizations/${organization.id}/conversations/${conversation.id}/reply`, headers: authed(agentToken), payload: { text: "Bonjour, je m'en occupe." } });

      expect(reply.statusCode).toBe(200);
      expect(hoisted.sent).toEqual([{ organizationId: organization.id, jid: "237655000001@s.whatsapp.net", text: "Bonjour, je m'en occupe." }]);
      const detail = await app.inject({ method: "GET", url: `/organizations/${organization.id}/conversations/${conversation.id}`, headers: authed(token) });
      expect(detail.json().conversation.messages[0]).toMatchObject({ author: "HUMAN", content: "Bonjour, je m'en occupe.", aiMeta: { sentBy: "Fatou" } });
    });

    it("désactiver un employé coupe son accès tout de suite, même avec une session ouverte", async () => {
      const { organization, token } = await setup();
      const added = await addAgent(token, organization.id);
      const { token: agentToken } = await login("fatou@example.com");
      const memberId = added.json().member.id as string;

      const off = await app.inject({ method: "PUT", url: `/organizations/${organization.id}/team/${memberId}`, headers: authed(token), payload: { active: false } });

      expect(off.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/me", headers: authed(agentToken) })).statusCode).toBe(401);
      const relogin = await login("fatou@example.com");
      expect(relogin.response.statusCode).toBe(403);
      expect(relogin.response.json().message).toContain("désactivé");

      await app.inject({ method: "PUT", url: `/organizations/${organization.id}/team/${memberId}`, headers: authed(token), payload: { active: true } });
      expect((await login("fatou@example.com")).response.statusCode).toBe(200);
    });

    it("refuse un employé avec une adresse déjà utilisée, un mot de passe trop court, et la modification du propriétaire", async () => {
      const { organization, user, token } = await setup();
      expect((await addAgent(token, organization.id, "owner@example.com")).statusCode).toBe(400);
      const short = await app.inject({ method: "POST", url: `/organizations/${organization.id}/team`, headers: authed(token), payload: { name: "Fatou", email: "f@example.com", password: "123" } });
      expect(short.statusCode).toBe(400);
      const self = await app.inject({ method: "PUT", url: `/organizations/${organization.id}/team/${user.id}`, headers: authed(token), payload: { active: false } });
      expect(self.statusCode).toBe(400);
      const removeSelf = await app.inject({ method: "DELETE", url: `/organizations/${organization.id}/team/${user.id}`, headers: authed(token) });
      expect(removeSelf.statusCode).toBe(400);
    });

    it("supprimer un employé supprime son accès", async () => {
      const { organization, token } = await setup();
      const added = await addAgent(token, organization.id);
      const { token: agentToken } = await login("fatou@example.com");
      const removed = await app.inject({ method: "DELETE", url: `/organizations/${organization.id}/team/${added.json().member.id}`, headers: authed(token) });
      expect(removed.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/me", headers: authed(agentToken) })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: `/organizations/${organization.id}/team`, headers: authed(token) })).json().members).toHaveLength(1);
    });

    it("un employé d'une entreprise ne peut pas être ajouté à l'équipe d'une autre", async () => {
      const mine = await setup();
      const other = await createTestOrganization("Autre", { email: "other@example.com", password: PASSWORD });
      const { token: otherToken } = await login("other@example.com");
      const response = await app.inject({ method: "POST", url: `/organizations/${mine.organization.id}/team`, headers: authed(otherToken), payload: { name: "X", email: "x@example.com", password: PASSWORD } });
      expect(response.statusCode).toBe(403);
      void other;
    });
  });

  describe("boîte de réception", () => {
    it("liste légèrement les conversations, place d'abord celles qui attendent une personne, et marque comme lu à l'ouverture", async () => {
      const { organization, token } = await setup();
      const make = async (number: string, stage: "NEW" | "CALLBACK" | "INTERESTED", status: "OPEN" | "HUMAN_HANDOFF", lastInboundAt: Date) => {
        const contact = await prisma.contact.create({ data: { organizationId: organization.id, whatsappJid: `${number}@s.whatsapp.net`, displayName: `Client ${number}` } });
        const conversation = await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id, stage, status, lastInboundAt } });
        await prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", author: "CONTACT", type: "TEXT", content: `Message de ${number}`, createdAt: lastInboundAt } });
        return conversation;
      };
      const base = new Date("2026-10-14T10:00:00Z");
      await make("1", "NEW", "OPEN", new Date(base.getTime() + 3000));
      const waiting = await make("2", "CALLBACK", "HUMAN_HANDOFF", base);
      await make("3", "INTERESTED", "OPEN", new Date(base.getTime() + 6000));

      const list = await app.inject({ method: "GET", url: `/organizations/${organization.id}/conversations`, headers: authed(token) });
      const items = list.json().conversations as Array<{ id: string; contact: { displayName: string }; lastMessage: { content: string }; unread: boolean; messageCount: number; messages?: unknown }>;

      expect(items.map((item) => item.contact.displayName)).toEqual(["Client 2", "Client 3", "Client 1"]);
      expect(items[0]).toMatchObject({ lastMessage: { content: "Message de 2" }, unread: true, messageCount: 1 });
      expect(items[0]?.messages).toBeUndefined();

      await app.inject({ method: "POST", url: `/organizations/${organization.id}/conversations/${waiting.id}/read`, headers: authed(token) });
      const after = await app.inject({ method: "GET", url: `/organizations/${organization.id}/conversations`, headers: authed(token) });
      expect((after.json().conversations as Array<{ id: string; unread: boolean }>).find((item) => item.id === waiting.id)?.unread).toBe(false);
    });

    it("filtre par étiquette, cherche par nom, et laisse le propriétaire fixer l'étiquette à la main", async () => {
      const { organization, token } = await setup();
      const contact = await prisma.contact.create({ data: { organizationId: organization.id, whatsappJid: "237655000009@s.whatsapp.net", displayName: "Amina Bello" } });
      const conversation = await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id } });
      const base = `/organizations/${organization.id}/conversations`;

      expect((await app.inject({ method: "GET", url: `${base}?stage=CALLBACK`, headers: authed(token) })).json().conversations).toHaveLength(0);
      const set = await app.inject({ method: "POST", url: `${base}/${conversation.id}/stage`, headers: authed(token), payload: { stage: "CALLBACK" } });
      expect(set.json().conversation).toMatchObject({ stage: "CALLBACK", stageLocked: true });
      expect((await app.inject({ method: "GET", url: `${base}?stage=CALLBACK`, headers: authed(token) })).json().conversations).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: `${base}?q=amina`, headers: authed(token) })).json().conversations).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: `${base}?q=zzz`, headers: authed(token) })).json().conversations).toHaveLength(0);
      const auto = await app.inject({ method: "POST", url: `${base}/${conversation.id}/stage`, headers: authed(token), payload: { stage: "AUTO" } });
      expect(auto.json().conversation.stageLocked).toBe(false);
    });

    it("sert une photo reçue avec un lien signé temporaire, et jamais sans lien ni pour une autre entreprise", async () => {
      const { organization, token } = await setup();
      const other = await createTestOrganization("Autre", { email: "other@example.com", password: PASSWORD });
      const contact = await prisma.contact.create({ data: { organizationId: organization.id, whatsappJid: "237655000001@s.whatsapp.net" } });
      const conversation = await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id } });
      const stored = await saveClientMedia(organization.id, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7]), "image/jpeg");
      await prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", author: "CONTACT", type: "IMAGE", content: "[Photo reçue]", mediaFile: stored.file, mediaMimeType: "image/jpeg" } });

      const detail = await app.inject({ method: "GET", url: `/organizations/${organization.id}/conversations/${conversation.id}`, headers: authed(token) });
      const mediaUrl = detail.json().conversation.messages[0].mediaUrl as string;
      expect(mediaUrl).toMatch(/^\/media\/client\//);

      const file = await app.inject({ method: "GET", url: mediaUrl });
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-type"]).toBe("image/jpeg");
      expect(file.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7]));

      expect((await app.inject({ method: "GET", url: `/media/client/${organization.id}/${stored.file}` })).statusCode).toBe(403); // sans lien signé
      const tampered = mediaUrl.replace(organization.id, other.organization.id);
      expect((await app.inject({ method: "GET", url: tampered })).statusCode).toBe(403); // lien d'une autre entreprise
    });
  });

  describe("commandes et paiements", () => {
    it("le propriétaire et l'employé marquent une commande payée", async () => {
      const { organization, token } = await setup();
      const order = await prisma.order.create({ data: { organizationId: organization.id, customerName: "Amina", deliveryAddress: "Akwa", items: [], total: 7000 } });
      const paid = await app.inject({ method: "PUT", url: `/organizations/${organization.id}/orders/${order.id}/payment`, headers: authed(token), payload: { paymentStatus: "PAID", paymentMethod: "Orange Money" } });
      expect(paid.json().order).toMatchObject({ paymentStatus: "PAID", paymentMethod: "Orange Money" });
      const listed = await app.inject({ method: "GET", url: `/organizations/${organization.id}/orders?payment=UNPAID`, headers: authed(token) });
      expect(listed.json().orders).toEqual([]);
    });
  });

  describe("corrections de l'assistant", () => {
    it("crée, liste, désactive et supprime une correction", async () => {
      const { organization, token } = await setup();
      const base = `/organizations/${organization.id}/ai-corrections`;
      const created = await app.inject({ method: "POST", url: base, headers: authed(token), payload: { question: "Vous livrez ?", correctReply: "Oui, partout à Douala." } });
      expect(created.statusCode).toBe(200);
      const id = created.json().correction.id as string;
      expect((await app.inject({ method: "GET", url: base, headers: authed(token) })).json().corrections).toHaveLength(1);
      expect((await app.inject({ method: "PUT", url: `${base}/${id}`, headers: authed(token), payload: { active: false } })).json().correction.active).toBe(false);
      expect((await app.inject({ method: "DELETE", url: `${base}/${id}`, headers: authed(token) })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: base, headers: authed(token) })).json().corrections).toHaveLength(0);
      expect((await app.inject({ method: "POST", url: base, headers: authed(token), payload: { correctReply: "" } })).statusCode).toBe(400);
    });
  });

  describe("messages groupés", () => {
    it("plus de 50 clients : le bouton n'est plus bloqué, l'envoi part par lots de 50", async () => {
      const { organization, token } = await setup();
      for (let index = 0; index < 60; index += 1) {
        const contact = await prisma.contact.create({ data: { organizationId: organization.id, whatsappJid: `2376600${String(index).padStart(5, "0")}@s.whatsapp.net` } });
        await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id, lastInboundAt: new Date(Date.now() - index * 60_000) } });
      }
      const base = `/organizations/${organization.id}/broadcasts`;
      const preview = await app.inject({ method: "POST", url: `${base}/preview`, headers: authed(token), payload: { text: "Promo lot" } });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().preview).toMatchObject({ ok: true, eligible: 60, recipients: 50, remaining: 10 });

      const created = await app.inject({ method: "POST", url: base, headers: authed(token), payload: { text: "Promo lot" } });
      expect(created.statusCode).toBe(200);
      expect(created.json().broadcast.total).toBe(50);
    });

    it("annonce combien de clients seront contactés, refuse sans WhatsApp, puis envoie", async () => {
      const { organization, token } = await setup();
      for (const number of ["1", "2"]) {
        const contact = await prisma.contact.create({ data: { organizationId: organization.id, whatsappJid: `23765500000${number}@s.whatsapp.net` } });
        await prisma.conversation.create({ data: { organizationId: organization.id, contactId: contact.id, lastInboundAt: new Date() } });
      }
      const base = `/organizations/${organization.id}/broadcasts`;

      const preview = await app.inject({ method: "GET", url: `${base}/preview`, headers: authed(token) });
      expect(preview.json().preview).toMatchObject({ recipients: 2, ok: true });

      hoisted.connected = false;
      const offline = await app.inject({ method: "POST", url: base, headers: authed(token), payload: { text: "Promo" } });
      expect(offline.statusCode).toBe(400);
      expect(offline.json().message).toContain("Connectez");

      hoisted.connected = true;
      const created = await app.inject({ method: "POST", url: base, headers: authed(token), payload: { text: "Promo ce week-end" } });
      expect(created.statusCode).toBe(200);
      const second = await app.inject({ method: "POST", url: base, headers: authed(token), payload: { text: "Autre promo" } });
      expect(second.statusCode).toBe(400);
      expect(second.json().message).toContain("déjà en cours");

      const cancelled = await app.inject({ method: "POST", url: `${base}/${created.json().broadcast.id}/cancel`, headers: authed(token) });
      expect(cancelled.json().broadcast.status).toBe("CANCELLED");
    });
  });
  describe("numéro WhatsApp de l'entreprise", () => {
    const registration = (extra: Record<string, unknown> = {}) => ({ name: "Awa", companyName: "Boutique Awa", email: "awa@example.com", password: PASSWORD, ...extra });
    let registerCounter = 0;
    const register = (payload: Record<string, unknown>) => {
      registerCounter += 1;
      return app.inject({ method: "POST", url: "/register", headers: { "x-forwarded-for": `172.16.0.${registerCounter}` }, payload });
    };

    it("l'inscription exige un numéro WhatsApp valide et le garde jusqu'à la création du compte", async () => {
      expect((await register(registration())).statusCode).toBe(400);
      const invalid = await register(registration({ whatsappNumber: "12345" }));
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().message).toMatch(/WhatsApp/);

      const accepted = await register(registration({ whatsappNumber: "+237 6 90 00 00 00" }));
      expect(accepted.statusCode).toBe(200);
      expect(await prisma.signupVerification.findUnique({ where: { email: "awa@example.com" } })).toMatchObject({ whatsappNumber: "237690000000" });
      expect(await prisma.organization.count()).toBe(0); // pas de compte avant le code

      await prisma.signupVerification.update({ where: { email: "awa@example.com" }, data: { codeHash: createHash("sha256").update("123456").digest("hex") } });
      const verified = await app.inject({ method: "POST", url: "/register/verify", headers: { "x-forwarded-for": "172.16.1.1" }, payload: { email: "awa@example.com", code: "123456" } });
      expect(verified.statusCode).toBe(200);
      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: verified.json().organizationId } });
      expect(organization.whatsappNumber).toBe("237690000000");

      const status = await app.inject({ method: "GET", url: `/organizations/${organization.id}/whatsapp/status`, headers: authed(verified.json().token) });
      expect(status.json()).toMatchObject({ declaredNumber: "237690000000", declaredDisplay: "+237 6 90 00 00 00", connectedNumber: null, numberMatches: null });
    });

    it("un numéro saisi sans indicatif reçoit celui du Cameroun", async () => {
      expect((await register(registration({ whatsappNumber: "690 00 00 01" }))).statusCode).toBe(200);
      expect(await prisma.signupVerification.findUnique({ where: { email: "awa@example.com" } })).toMatchObject({ whatsappNumber: "237690000001" });
    });

    it("un ancien compte sans numéro peut l'ajouter, et on voit si le téléphone relié est un autre numéro", async () => {
      const { organization, token } = await setup();
      const before = await app.inject({ method: "GET", url: `/organizations/${organization.id}/whatsapp/status`, headers: authed(token) });
      expect(before.json()).toMatchObject({ declaredNumber: null });

      const bad = await app.inject({ method: "PUT", url: `/organizations/${organization.id}/whatsapp/number`, headers: authed(token), payload: { phoneNumber: "abc" } });
      expect(bad.statusCode).toBe(400);

      const saved = await app.inject({ method: "PUT", url: `/organizations/${organization.id}/whatsapp/number`, headers: authed(token), payload: { phoneNumber: "699 00 00 02" } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ declaredNumber: "237699000002", numberMatches: null });

      await prisma.whatsAppAccount.create({ data: { organizationId: organization.id, phoneNumber: "237699000002", status: "CONNECTED" } });
      expect((await app.inject({ method: "GET", url: `/organizations/${organization.id}/whatsapp/status`, headers: authed(token) })).json()).toMatchObject({ connectedNumber: "237699000002", numberMatches: true });
      await prisma.whatsAppAccount.updateMany({ where: { organizationId: organization.id }, data: { phoneNumber: "237677000000" } });
      expect((await app.inject({ method: "GET", url: `/organizations/${organization.id}/whatsapp/status`, headers: authed(token) })).json()).toMatchObject({ connectedNumber: "237677000000", numberMatches: false });
    });

    it("un employé ne peut pas changer le numéro de l'entreprise", async () => {
      const { organization, token } = await setup();
      await app.inject({ method: "POST", url: `/organizations/${organization.id}/team`, headers: authed(token), payload: { name: "Fatou", email: "fatou@example.com", password: PASSWORD } });
      const agent = await login("fatou@example.com");
      const response = await app.inject({ method: "PUT", url: `/organizations/${organization.id}/whatsapp/number`, headers: authed(agent.token), payload: { phoneNumber: "690000009" } });
      expect(response.statusCode).toBe(403);
    });
  });

  describe("forfaits", () => {
    afterAll(() => setBillingEnforcedForTests(null));
    const ADMIN = { authorization: "Bearer admin-token-admin-token-admin-token-0123" };

    it("la liste des forfaits est publique et montre l'essai et les trois forfaits", async () => {
      const response = await app.inject({ method: "GET", url: "/billing/plans" });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.plans.map((plan: { name: string; amount: number }) => [plan.name, plan.amount])).toEqual([["Essentiel", 10000], ["Pro", 20000], ["Business", 50000]]);
      expect(body.trial).toMatchObject({ messages: 100 });
    });

    it("le propriétaire voit son essai ; un employé n'a pas accès à la facturation", async () => {
      const { organization, token } = await setup();
      await prisma.organization.update({ where: { id: organization.id }, data: { freeAiResponsesRemaining: 100 } });
      const account = await app.inject({ method: "GET", url: "/billing/account", headers: authed(token) });
      expect(account.json()).toMatchObject({ plan: "trial", planName: "Essai gratuit", remainingMessages: 100, messageLimit: 100, enforced: false, blocked: false });

      await app.inject({ method: "POST", url: `/organizations/${organization.id}/team`, headers: authed(token), payload: { name: "Fatou", email: "fatou@example.com", password: PASSWORD } });
      const agent = await login("fatou@example.com");
      expect((await app.inject({ method: "GET", url: "/billing/account", headers: authed(agent.token) })).statusCode).toBe(403);
    });

    it("forfaits appliqués : l'Essentiel n'ouvre ni messages en masse ni employés (402), le Pro oui", async () => {
      const { organization, token } = await setup();
      setBillingEnforcedForTests(true);
      const expiresAt = new Date(Date.now() + 20 * 24 * 3600_000);
      await prisma.billingSubscription.create({ data: { organizationId: organization.id, plan: "starter", messageLimit: 1000, expiresAt } });

      const blocked = await app.inject({ method: "POST", url: `/organizations/${organization.id}/broadcasts/preview`, headers: authed(token), payload: { text: "Promo" } });
      expect(blocked.statusCode).toBe(402);
      expect(blocked.json()).toMatchObject({ error: "PLAN_LIMIT", message: expect.stringContaining("forfait Pro") });
      const team = await app.inject({ method: "POST", url: `/organizations/${organization.id}/team`, headers: authed(token), payload: { name: "Fatou", email: "fatou@example.com", password: PASSWORD } });
      expect(team.statusCode).toBe(402);
      // L'historique reste consultable même sans la fonction.
      expect((await app.inject({ method: "GET", url: `/organizations/${organization.id}/broadcasts`, headers: authed(token) })).statusCode).toBe(200);

      await prisma.billingSubscription.update({ where: { organizationId: organization.id }, data: { plan: "pro", messageLimit: 5000 } });
      expect((await app.inject({ method: "POST", url: `/organizations/${organization.id}/broadcasts/preview`, headers: authed(token), payload: { text: "Promo" } })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: `/organizations/${organization.id}/team`, headers: authed(token), payload: { name: "Fatou", email: "fatou@example.com", password: PASSWORD } })).statusCode).toBe(200);
    });

    it("l'administrateur de la plateforme active un forfait à la main (paiement reçu hors ligne)", async () => {
      const { organization, token } = await setup();
      await prisma.organization.update({ where: { id: organization.id }, data: { quotaNoticeAt: new Date() } });
      const url = `/admin/organizations/${organization.id}/subscription`;

      expect((await app.inject({ method: "POST", url, payload: { plan: "pro" } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url, headers: authed(token), payload: { plan: "pro" } })).statusCode).toBe(403); // un propriétaire d'entreprise n'est pas administrateur
      expect((await app.inject({ method: "POST", url, headers: ADMIN, payload: { plan: "gratuit" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/admin/organizations/inconnue/subscription", headers: ADMIN, payload: { plan: "pro" } })).statusCode).toBe(404);

      const granted = await app.inject({ method: "POST", url, headers: ADMIN, payload: { plan: "Pro", days: 45 } });
      expect(granted.statusCode).toBe(200);
      expect(granted.json().billing).toMatchObject({ plan: "pro", planName: "Pro", status: "ACTIVE", messageLimit: 5000, messagesUsed: 0 });
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).quotaNoticeAt).toBeNull();
      const days = ((await prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId: organization.id } })).expiresAt.getTime() - Date.now()) / (24 * 3600_000);
      expect(Math.round(days)).toBe(45);

      const list = await app.inject({ method: "GET", url: "/admin/organizations", headers: ADMIN });
      expect(list.json().organizations[0].billing).toMatchObject({ plan: "pro", messagesUsed: 0, messageLimit: 5000 });
      expect((await app.inject({ method: "GET", url: "/billing/account", headers: authed(token) })).json()).toMatchObject({ plan: "pro", amount: 20000 });
    });
  });
  describe("assistant d'aide du tableau de bord", () => {
    const prompts: string[] = [];
    const histories: Array<Array<{ role: string; content: string }>> = [];
    let failing = false;
    const fakeProvider = {
      name: "fake",
      async generateResponse(input: { systemPrompt: string; history: Array<{ role: string; content: string }> }) {
        if (failing) throw new Error("API en panne");
        prompts.push(input.systemPrompt);
        histories.push(input.history);
        return { rawText: JSON.stringify({ reply: "Allez dans la page « WhatsApp ».", openView: "whatsapp" }), latencyMs: 1 };
      },
      async transcribeAudio() { return ""; },
    };
    beforeEach(() => {
      prompts.length = 0; histories.length = 0; failing = false;
      resetSupportRateLimitForTests();
      setSupportProvidersForTests([fakeProvider]);
    });
    afterAll(() => setSupportProvidersForTests(null));
    const chat = (orgId: string, token: string | undefined, payload: unknown) =>
      app.inject({ method: "POST", url: `/organizations/${orgId}/support-assistant/chat`, headers: authed(token), payload: payload as object });

    it("répond avec la base de connaissances et la situation réelle du compte", async () => {
      hoisted.connected = false;
      const { organization, token } = await setup();
      await prisma.product.create({ data: { organizationId: organization.id, name: "Robe", description: "Robe rouge" } });
      const response = await chat(organization.id, token, { messages: [{ role: "user", content: "Comment connecter mon WhatsApp ?" }] });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ reply: "Allez dans la page « WhatsApp ».", openView: "whatsapp" });
      expect(prompts[0]).toContain("Appareils liés");
      expect(prompts[0]).toContain("WhatsApp : NON connecté");
      expect(prompts[0]).toContain("Produits : 1 (dont 1 disponibles)");
      expect(prompts[0]).toContain("Entreprise : Salon Éclat");
      expect(histories[0]).toEqual([{ role: "user", content: "Comment connecter mon WhatsApp ?" }]);
    });

    it("garde le fil de la discussion et signale le blocage du forfait", async () => {
      const { organization, token } = await setup();
      setBillingEnforcedForTests(true);
      try {
        await chat(organization.id, token, { messages: [
          { role: "user", content: "L'agent ne répond plus" },
          { role: "assistant", content: "Avez-vous encore des messages ?" },
          { role: "user", content: "Je ne sais pas" },
        ] });
      } finally { setBillingEnforcedForTests(false); }
      expect(histories[0]).toHaveLength(3);
      expect(prompts[0]).toContain("ATTENTION : l'agent est actuellement bloqué");
    });

    it("refuse les employés, les inconnus, une autre entreprise et une demande vide", async () => {
      const { organization, token } = await setup();
      const other = await createTestOrganization("Autre", { email: "other@example.com", password: PASSWORD });
      const otherLogin = await login("other@example.com");
      const messages = [{ role: "user", content: "Bonjour" }];
      expect((await app.inject({ method: "POST", url: `/organizations/${organization.id}/support-assistant/chat`, payload: { messages } })).statusCode).toBe(401);
      expect((await chat(organization.id, otherLogin.token, { messages })).statusCode).toBeGreaterThanOrEqual(403);
      expect((await chat(other.organization.id, token, { messages })).statusCode).toBeGreaterThanOrEqual(403);
      expect((await chat(organization.id, token, { messages: [] })).statusCode).toBe(400);
      expect((await chat(organization.id, token, { messages: [{ role: "user", content: "   " }] })).statusCode).toBe(400);
      expect((await chat(organization.id, token, { messages: [{ role: "user", content: "Q" }, { role: "assistant", content: "R" }] })).statusCode).toBe(400);
      await prisma.user.create({ data: { organizationId: organization.id, email: "agent@example.com", passwordHash: await hashPassword(PASSWORD), name: "Awa", role: "AGENT" } });
      const agent = await login("agent@example.com");
      expect((await chat(organization.id, agent.token, { messages })).statusCode).toBe(403);
      expect(prompts).toHaveLength(0);
    });

    it("explique honnêtement quand l'IA est en panne, et limite le nombre de questions", async () => {
      const { organization, token } = await setup();
      failing = true;
      const down = await chat(organization.id, token, { messages: [{ role: "user", content: "Bonjour" }] });
      expect(down.statusCode).toBe(502);
      expect(down.json().message).toContain("+237 683 26 05 20");
      failing = false;
      for (let i = 0; i < 39; i++) await chat(organization.id, token, { messages: [{ role: "user", content: "Bonjour" }] });
      expect((await chat(organization.id, token, { messages: [{ role: "user", content: "Bonjour" }] })).statusCode).toBe(429);
    });
  });
  describe("administration : réponses de l'IA par entreprise", () => {
    const ADMIN = { authorization: "Bearer admin-token-admin-token-admin-token-0123" };
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600_000);

    async function seedAiMessages(organizationId: string, jid: string, counts: { today?: number; threeDays?: number; fortyDays?: number; human?: number; inbound?: number }) {
      const contact = await prisma.contact.create({ data: { organizationId, whatsappJid: jid } });
      const conversation = await prisma.conversation.create({ data: { organizationId, contactId: contact.id } });
      const make = (author: "AI" | "HUMAN" | "CONTACT", direction: "INBOUND" | "OUTBOUND", createdAt: Date) =>
        ({ conversationId: conversation.id, author, direction, content: "x", createdAt });
      const rows = [
        ...Array.from({ length: counts.today ?? 0 }, () => make("AI", "OUTBOUND", new Date())),
        ...Array.from({ length: counts.threeDays ?? 0 }, () => make("AI", "OUTBOUND", daysAgo(3))),
        ...Array.from({ length: counts.fortyDays ?? 0 }, () => make("AI", "OUTBOUND", daysAgo(40))),
        ...Array.from({ length: counts.human ?? 0 }, () => make("HUMAN", "OUTBOUND", new Date())),
        ...Array.from({ length: counts.inbound ?? 0 }, () => make("CONTACT", "INBOUND", new Date())),
      ];
      await prisma.message.createMany({ data: rows });
    }

    it("donne, pour chaque entreprise, le nombre de réponses générées par l'IA (aujourd'hui, 7 j, 30 j, total)", async () => {
      const { organization, token } = await setup();
      const other = await createTestOrganization("Boutique Awa", { email: "awa@example.com", password: PASSWORD });
      const quiet = await createTestOrganization("Sans activité", { email: "quiet@example.com", password: PASSWORD });
      await seedAiMessages(organization.id, "237690000001@s.whatsapp.net", { today: 3, threeDays: 2, fortyDays: 5, human: 4, inbound: 6 });
      await seedAiMessages(other.organization.id, "237690000002@s.whatsapp.net", { today: 1 });

      expect((await app.inject({ method: "GET", url: "/admin/organizations" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/admin/organizations", headers: authed(token) })).statusCode).toBe(403);

      const response = await app.inject({ method: "GET", url: "/admin/organizations", headers: ADMIN });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const byId = Object.fromEntries(body.organizations.map((entry: { id: string }) => [entry.id, entry]));
      // Les messages du client et ceux écrits par un humain ne comptent pas ; ceux d'il y a 40 jours comptent seulement dans le total.
      expect(byId[organization.id].aiResponses).toMatchObject({ today: 3, last7Days: 5, last30Days: 5, total: 10 });
      expect(byId[organization.id].aiResponses.lastAt).toEqual(expect.any(String));
      expect(byId[other.organization.id].aiResponses).toMatchObject({ today: 1, last7Days: 1, last30Days: 1, total: 1 });
      expect(byId[quiet.organization.id].aiResponses).toEqual({ today: 0, last7Days: 0, last30Days: 0, total: 0, lastAt: null });
      expect(byId[organization.id].owner).toMatchObject({ email: "owner@example.com" });
      expect(body.totals).toEqual({ organizations: 3, today: 4, last7Days: 6, last30Days: 6, total: 11 });
    });

    it("détaille les réponses de l'IA jour par jour pour une entreprise", async () => {
      const { organization, token } = await setup();
      await seedAiMessages(organization.id, "237690000003@s.whatsapp.net", { today: 2, threeDays: 1, fortyDays: 9 });
      const url = `/admin/organizations/${organization.id}/ai-usage`;

      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url, headers: authed(token) })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/admin/organizations/inconnue/ai-usage", headers: ADMIN })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `${url}?days=1`, headers: ADMIN })).statusCode).toBe(400);

      const response = await app.inject({ method: "GET", url: `${url}?days=30`, headers: ADMIN });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.daily).toHaveLength(30);
      expect(body.total).toBe(3); // les 9 messages d'il y a 40 jours sont hors de la fenêtre
      expect(body.daily.at(-1).count).toBe(2);
      expect(body.daily.at(-4).count).toBe(1);
      expect(body.daily.slice(0, 26).every((day: { count: number }) => day.count === 0)).toBe(true);
      expect(body.daily.map((day: { date: string }) => day.date)).toEqual([...body.daily.map((day: { date: string }) => day.date)].sort());
    });
  });
  describe("sécurité de la connexion", () => {
    beforeEach(() => resetRateLimitsForTests());
    // Derrière le proxy de l'hébergeur, l'adresse réelle est la dernière de la liste ; ce que le client écrit avant ne compte pas.
    const attempt = (email: string, password: string, spoofed: string, real = "203.0.113.9") =>
      app.inject({ method: "POST", url: "/login", headers: { "x-forwarded-for": `${spoofed}, ${real}` }, payload: { email, password } });

    it("ignore l'adresse écrite par le client : changer d'en-tête ne remet pas le compteur à zéro", async () => {
      await setup();
      let blocked = 0;
      for (let i = 0; i < 40; i++) {
        const response = await attempt(`inconnu${i}@example.com`, "mauvais", `198.51.100.${i}`);
        if (response.statusCode === 429) blocked += 1;
      }
      expect(blocked).toBeGreaterThanOrEqual(10);
    });

    it("verrouille le compte après 10 échecs, même depuis des adresses différentes, puis refuse le bon mot de passe", async () => {
      await setup();
      for (let i = 0; i < 10; i++) {
        const response = await attempt("owner@example.com", "mauvais-mot-de-passe", "198.51.100.1", `203.0.113.${i + 1}`);
        expect(response.statusCode).toBe(401);
      }
      const locked = await attempt("owner@example.com", PASSWORD, "198.51.100.1", "203.0.113.200");
      expect(locked.statusCode).toBe(429);
      expect(locked.json().token).toBeUndefined();
      // Un autre compte n'est pas touché.
      await createTestOrganization("Autre", { email: "autre@example.com", password: PASSWORD });
      expect((await attempt("autre@example.com", PASSWORD, "198.51.100.1", "203.0.113.201")).statusCode).toBe(200);
    });

    it("remplace une ancienne empreinte SHA-256 par une empreinte salée à la première connexion réussie", async () => {
      const { user } = await setup();
      const legacy = createHash("sha256").update(PASSWORD).digest("hex");
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: legacy } });

      expect((await attempt("owner@example.com", "mauvais", "1.1.1.1", "203.0.113.50")).statusCode).toBe(401);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(legacy);

      expect((await attempt("owner@example.com", PASSWORD, "1.1.1.1", "203.0.113.51")).statusCode).toBe(200);
      const upgraded = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;
      expect(upgraded).toMatch(/^scrypt\$/);
      expect((await attempt("owner@example.com", PASSWORD, "1.1.1.1", "203.0.113.52")).statusCode).toBe(200);
    });

    it("la déconnexion supprime la session côté serveur : l'ancien jeton ne marche plus", async () => {
      const { token } = await setup();
      expect((await app.inject({ method: "GET", url: "/me", headers: authed(token) })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/logout", headers: authed(token) })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/me", headers: authed(token) })).statusCode).toBe(401);
      // Sans jeton, la déconnexion répond quand même sans erreur.
      expect((await app.inject({ method: "POST", url: "/logout" })).statusCode).toBe(200);
    });

    it("la création d'entreprise à part est réservée à l'administrateur de la plateforme", async () => {
      const { token } = await setup();
      expect((await app.inject({ method: "POST", url: "/organizations", payload: { name: "Spam" } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/organizations", headers: authed(token), payload: { name: "Spam" } })).statusCode).toBe(403);
      expect(await prisma.organization.count()).toBe(1);
    });
  });
  describe("image de l'agent", () => {
    it("refuse une adresse interne, blob: et SVG, mais accepte une adresse publique", async () => {
      const { organization, token } = await setup();
      const put = (agentImageUrl: string) => app.inject({ method: "PUT", url: `/organizations/${organization.id}/ai-settings`, headers: authed(token), payload: { agentImageUrl } });
      for (const url of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:6379/", "blob:https://x.com/a", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="]) {
        expect((await put(url)).statusCode, url).toBe(400);
      }
      expect((await put("https://exemple.cm/logo.png")).statusCode).toBe(200);
      expect((await put("")).statusCode).toBe(200);
    });
  });
  describe("isolation entre entreprises : identifiants d'une autre entreprise", () => {
    it("une entreprise ne peut ni lire ni modifier les éléments d'une autre, même en connaissant leurs identifiants", async () => {
      const a = await setup();
      const b = await createTestOrganization("Entreprise B", { email: "b@example.com", password: PASSWORD });
      const bLogin = await login("b@example.com");
      const A = a.organization.id;
      const B = b.organization.id;

      const contact = await prisma.contact.create({ data: { organizationId: A, whatsappJid: "237690000009@s.whatsapp.net", displayName: "Client de A" } });
      const conversation = await prisma.conversation.create({ data: { organizationId: A, contactId: contact.id } });
      const message = await prisma.message.create({ data: { conversationId: conversation.id, direction: "OUTBOUND", author: "AI", content: "Réponse de A" } });
      const product = await prisma.product.create({ data: { organizationId: A, name: "Produit A", description: "Secret de A" } });
      const order = await prisma.order.create({ data: { organizationId: A, customerName: "Client de A", deliveryAddress: "Rue de A", items: [] } });
      const appointment = await prisma.appointment.create({ data: { organizationId: A, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) } });
      const correction = await prisma.aiCorrection.create({ data: { organizationId: A, question: "Question de A", correctReply: "Réponse de A" } });
      const location = await prisma.location.create({ data: { organizationId: A, name: "Zone A", city: "Douala" } });
      const responsible = await prisma.responsible.create({ data: { organizationId: A, locationId: location.id, name: "Resp A", whatsappNumber: "237690000010" } });
      const broadcast = await prisma.broadcast.create({ data: { organizationId: A, text: "Annonce de A" } });
      const agent = await prisma.user.create({ data: { organizationId: A, email: "agent-a@example.com", passwordHash: "x", name: "Agent A", role: "AGENT" } });

      const asB = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, payload?: object) =>
        app.inject({ method, url: `/organizations/${B}${path}`, headers: authed(bLogin.token), ...(payload ? { payload } : {}) });
      const attempts: Array<[string, Promise<{ statusCode: number }>]> = [
        ["lire la conversation", asB("GET", `/conversations/${conversation.id}`)],
        ["répondre dans la conversation", asB("POST", `/conversations/${conversation.id}/reply`, { text: "intrusion" })],
        ["marquer comme lue", asB("POST", `/conversations/${conversation.id}/read`)],
        ["changer l'étiquette", asB("POST", `/conversations/${conversation.id}/stage`, { stage: "ORDERED" })],
        ["couper l'IA", asB("POST", `/conversations/${conversation.id}/ai/disable`)],
        ["réactiver l'IA", asB("POST", `/conversations/${conversation.id}/ai/enable`)],
        ["bloquer le client", asB("POST", `/conversations/${conversation.id}/opt-out`, { optedOut: true })],
        ["signaler un paiement", asB("POST", `/conversations/${conversation.id}/payment-check`, { pending: true })],
        ["corriger un message", asB("POST", `/conversations/${conversation.id}/messages/${message.id}/correct`, { correctReply: "intrusion" })],
        ["modifier le produit", asB("PUT", `/products/${product.id}`, { name: "Piraté", description: "Piraté" })],
        ["supprimer le produit", asB("DELETE", `/products/${product.id}`)],
        ["modifier la commande", asB("PUT", `/orders/${order.id}`, { status: "CANCELLED" })],
        ["marquer la commande payée", asB("PUT", `/orders/${order.id}/payment`, { paymentStatus: "PAID" })],
        ["modifier le rendez-vous", asB("PUT", `/appointments/${appointment.id}`, { status: "CANCELLED" })],
        ["modifier la correction", asB("PUT", `/ai-corrections/${correction.id}`, { correctReply: "Piraté" })],
        ["supprimer la correction", asB("DELETE", `/ai-corrections/${correction.id}`)],
        ["modifier l'employé", asB("PUT", `/team/${agent.id}`, { active: false })],
        ["supprimer l'employé", asB("DELETE", `/team/${agent.id}`)],
        ["lire l'envoi groupé", asB("GET", `/broadcasts/${broadcast.id}`)],
        ["annuler l'envoi groupé", asB("POST", `/broadcasts/${broadcast.id}/cancel`)],
        ["lister les responsables d'une zone", asB("GET", `/locations/${location.id}/responsibles`)],
        ["modifier le responsable", asB("PUT", `/responsibles/${responsible.id}`, { name: "Piraté" })],
        ["supprimer le responsable", asB("DELETE", `/responsibles/${responsible.id}`)],
      ];
      for (const [label, pending] of attempts) {
        const response = await pending as { statusCode: number; body: string };
        if (label === "lister les responsables d'une zone") {
          // Liste filtrée par entreprise : réponse vide, rien de l'autre entreprise.
          expect(response.statusCode).toBe(200);
          expect(JSON.parse(response.body).responsibles).toEqual([]);
          continue;
        }
        expect(response.statusCode, `${label} → ${response.statusCode}`).toBeGreaterThanOrEqual(400);
        expect(response.body, label).not.toMatch(/Client de A|Produit A|Secret de A|Réponse de A|Annonce de A|Resp A|Rue de A/);
      }

      // Rien n'a bougé chez l'entreprise A.
      expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).name).toBe("Produit A");
      expect(await prisma.order.count({ where: { id: order.id, status: "NEW" } })).toBe(1);
      expect(await prisma.aiCorrection.count({ where: { id: correction.id } })).toBe(1);
      expect(await prisma.responsible.count({ where: { id: responsible.id } })).toBe(1);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: agent.id } })).active).toBe(true);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).stageLocked).toBe(false);
      expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(1);
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).optedOut).toBe(false);

      // L'adresse d'une autre entreprise est refusée, quelle que soit la façon de l'écrire.
      for (const path of [`/organizations/${A}/products`, `/organizations/${A.toUpperCase()}/products`, `/organizations/${encodeURIComponent(A)}/products`, `/organizations/%2e%2e/${A}/products`, `//organizations/${A}/products`, `/organizations/${B}/../${A}/products`, `/organizations/${A};x/products`]) {
        const response = await app.inject({ method: "GET", url: path, headers: authed(bLogin.token) });
        expect(response.statusCode, path).not.toBe(200);
        expect(response.body, path).not.toContain("Produit A");
      }
    });
  });
  describe("visites de la page d'accueil (compteur anonyme)", () => {
    const ADMIN = { authorization: "Bearer admin-token-admin-token-admin-token-0123" };

    it("compte une vraie visite, ignore les robots et répond sans authentification", async () => {
      const real = await app.inject({ method: "POST", url: "/analytics/landing-view", headers: { "x-forwarded-for": "198.51.100.11", "user-agent": "Mozilla/5.0 (iPhone)" } });
      expect(real.statusCode).toBe(202);
      expect(real.json()).toEqual({ recorded: true });

      const bot = await app.inject({ method: "POST", url: "/analytics/landing-view", headers: { "x-forwarded-for": "198.51.100.12", "user-agent": "Googlebot/2.1" } });
      expect(bot.json()).toEqual({ recorded: false });

      // Un en-tête vide (certains outils l'envoient ainsi) compte aussi comme un robot.
      const noUserAgent = await app.inject({ method: "POST", url: "/analytics/landing-view", headers: { "x-forwarded-for": "198.51.100.13", "user-agent": "" } });
      expect(noUserAgent.json()).toEqual({ recorded: false });

      const stats = await app.inject({ method: "GET", url: "/admin/analytics/landing-views", headers: ADMIN });
      expect(stats.statusCode).toBe(200);
      const body = stats.json();
      expect(body.today.views).toBeGreaterThanOrEqual(1);
      expect(body.total.views).toBeGreaterThanOrEqual(1);
      expect(body.daily.at(-1).views).toBeGreaterThanOrEqual(1);
    });

    it("n'enregistre pas deux fois la même adresse dans les 5 secondes, et refuse l'accès aux statistiques sans être administrateur", async () => {
      const ip = { "x-forwarded-for": "198.51.100.20", "user-agent": "Mozilla/5.0 (Macintosh)" };
      const before = (await app.inject({ method: "GET", url: "/admin/analytics/landing-views", headers: ADMIN })).json().today.views;
      await app.inject({ method: "POST", url: "/analytics/landing-view", headers: ip });
      const second = await app.inject({ method: "POST", url: "/analytics/landing-view", headers: ip });
      expect(second.json()).toEqual({ recorded: false });
      const after = (await app.inject({ method: "GET", url: "/admin/analytics/landing-views", headers: ADMIN })).json().today.views;
      expect(after).toBe(before + 1);

      expect((await app.inject({ method: "GET", url: "/admin/analytics/landing-views" })).statusCode).toBe(401);
      const { token } = await setup();
      expect((await app.inject({ method: "GET", url: "/admin/analytics/landing-views", headers: authed(token) })).statusCode).toBe(403);
    });

    it("ne stocke ni adresse IP ni identifiant lisible : seule une empreinte qui change chaque jour est gardée", async () => {
      await app.inject({ method: "POST", url: "/analytics/landing-view", headers: { "x-forwarded-for": "203.0.113.77", "user-agent": "Mozilla/5.0 (Linux; Android 10)" } });
      const rows = await prisma.landingPageView.findMany({ orderBy: { createdAt: "desc" }, take: 1 });
      expect(rows[0]!.visitorHash).not.toContain("203.0.113.77");
      expect(rows[0]!.visitorHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
