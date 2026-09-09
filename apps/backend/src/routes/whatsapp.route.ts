import type { FastifyInstance } from "fastify";
import {
  connectWhatsAppAccount,
  disconnectWhatsAppAccount,
  getWhatsAppAccountQr,
  getWhatsAppAccountStatus,
} from "../whatsapp/whatsapp.registry.js";

export async function whatsappRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/whatsapp/status", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { status: getWhatsAppAccountStatus(orgId) };
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
    // Ne bloque pas la requête HTTP le temps que la connexion s'établisse.
    connectWhatsAppAccount(orgId).catch((error) => {
      app.log.error(error, `Échec de connexion WhatsApp pour l'organisation ${orgId}`);
    });
    return { message: "Connexion WhatsApp initiée." };
  });

  app.post("/organizations/:orgId/whatsapp/disconnect", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await disconnectWhatsAppAccount(orgId);
    return { message: "Déconnexion WhatsApp effectuée." };
  });
}
