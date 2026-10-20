import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  process.env.CLIENT_MEDIA_DIR = `/tmp/brayano-test-app-media-${process.pid}`;
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
import { prisma } from "./database/client.js";
import { saveClientMedia } from "./media/client-media.service.js";
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
});
