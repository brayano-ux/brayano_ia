import type { FastifyInstance } from "fastify";
import {
  connectWhatsAppAccount,
  connectWhatsAppAccountWithPairingCode,
  disconnectWhatsAppAccount,
  getWhatsAppAccountPairingCode,
  getWhatsAppAccountQr,
  getWhatsAppAccountStatus,
} from "../whatsapp/whatsapp.registry.js";
import { ValidationError } from "../shared/errors.js";
import { normalizeWhatsAppNumber } from "../shared/phone.js";
import { getWhatsAppNumberInfo, setDeclaredWhatsAppNumber } from "../whatsapp/whatsapp-number.service.js";

export async function whatsappRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/whatsapp/status", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const numbers = await getWhatsAppNumberInfo(orgId).catch(() => ({ declaredNumber: null, declaredDisplay: null, connectedNumber: null, numberMatches: null }));
    return { status: getWhatsAppAccountStatus(orgId), ...numbers };
  });

  // Numéro WhatsApp de l'entreprise (donné à l'inscription) : modifiable par le propriétaire.
  app.put("/organizations/:orgId/whatsapp/number", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const body = request.body as { phoneNumber?: unknown } | undefined;
    if (typeof body?.phoneNumber !== "string") throw new ValidationError("Indiquez le numéro WhatsApp de l'entreprise.");
    return { message: "Numéro enregistré.", ...(await setDeclaredWhatsAppNumber(orgId, body.phoneNumber)) };
  });

  app.get("/organizations/:orgId/whatsapp/qr", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const qr = getWhatsAppAccountQr(orgId);
    if (!qr) {
      reply.status(404);
      return { message: "Aucun QR code disponible pour le moment." };
    }
    return { qr };
  });

  app.get("/organizations/:orgId/whatsapp/pairing-code", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const code = getWhatsAppAccountPairingCode(orgId);
    if (!code) {
      reply.status(404);
      return { message: "Aucun code d'association disponible pour le moment." };
    }
    return { code };
  });

  // Page pratique pour scanner sans manipuler le JSON à la main.
  app.get("/organizations/:orgId/whatsapp/qr-view", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const qr = getWhatsAppAccountQr(orgId);
    const status = getWhatsAppAccountStatus(orgId);

    if (status === "CONNECTED") {
      reply.type("text/html");
      return "<h1>✅ WhatsApp est connecté pour cette entreprise.</h1>";
    }

    if (!qr) {
      reply.type("text/html").header("Refresh", "2");
      return "<h1>QR non disponible pour l'instant... (actualisation auto)</h1>";
    }

    reply.type("text/html").header("Refresh", "20");
    return `
      <html>
        <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;">
          <h2>Scanne avec WhatsApp &gt; Appareils liés &gt; Lier un appareil</h2>
          <img src="${qr}" style="width:300px;height:300px;" />
          <p>Cette page se rafraîchit automatiquement toutes les 20 secondes.</p>
        </body>
      </html>
    `;
  });

  app.post("/organizations/:orgId/whatsapp/connect", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await connectWhatsAppAccount(orgId);
    return {
      message: "Connexion WhatsApp initiée.",
      status: getWhatsAppAccountStatus(orgId),
    };
  });

  app.post("/organizations/:orgId/whatsapp/connect-with-code", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const body = request.body as { phoneNumber?: unknown } | undefined;
    const typed = typeof body?.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    // Sans numéro saisi, on utilise celui donné à l'inscription.
    const input = typed || (await getWhatsAppNumberInfo(orgId).catch(() => null))?.declaredNumber || "";
    if (!input) {
      reply.status(400);
      return { message: "Saisissez un numéro WhatsApp avec son indicatif pays." };
    }

    const phoneNumber = normalizeWhatsAppNumber(input);
    if (!phoneNumber) {
      reply.status(400);
      return { message: "Le numéro doit contenir l'indicatif pays et entre 8 et 15 chiffres." };
    }

    let code: string;
    try {
      code = await connectWhatsAppAccountWithPairingCode(orgId, phoneNumber);
    } catch (error) {
      request.log.error({ err: error, orgId }, "Échec de génération du code d'association WhatsApp");
      reply.status(502);
      return {
        message: error instanceof Error
          ? error.message
          : "WhatsApp n'a pas pu générer le code. Réessayez.",
      };
    }

    return {
      message: "Code d'association WhatsApp généré.",
      code,
      status: getWhatsAppAccountStatus(orgId),
    };
  });

  app.post("/organizations/:orgId/whatsapp/disconnect", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await disconnectWhatsAppAccount(orgId);
    return { message: "Déconnexion WhatsApp effectuée." };
  });
}
