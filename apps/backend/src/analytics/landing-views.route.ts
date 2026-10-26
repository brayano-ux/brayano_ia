import type { FastifyInstance } from "fastify";
import { evaluateRateLimit } from "../auth/rate-limit.js";
import { isLikelyBot, recordLandingPageView } from "./landing-views.service.js";

function clientIp(request: { ip?: string | undefined }): string {
  return request.ip ?? "unknown";
}

/**
 * Compteur de visites de la page d'accueil : pas de cookie, pas d'adresse IP conservée, pas de revente à un tiers.
 * `POST /analytics/landing-view` est appelé par la page elle-même, une fois par chargement ; `GET` (réservé à
 * l'administrateur) donne les chiffres.
 */
export async function landingViewsRoute(app: FastifyInstance) {
  app.post("/analytics/landing-view", async (request, reply) => {
    const ip = clientIp(request);
    // Une visite par adresse toutes les 5 secondes suffit largement à un vrai visiteur ; au-delà, on ignore sans erreur.
    if (!evaluateRateLimit(`landing-view:${ip}`, 1, 5_000)) return { recorded: false };
    const userAgent = String(request.headers["user-agent"] ?? "");
    if (isLikelyBot(userAgent)) return { recorded: false };
    await recordLandingPageView(ip, userAgent);
    reply.code(202);
    return { recorded: true };
  });
}
