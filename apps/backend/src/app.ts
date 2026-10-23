import Fastify from "fastify";
import { onboardingRoute } from "./onboarding/onboarding.route.js";
import { env } from "./config/env.js";
import { appointmentsRoute } from "./appointments/appointments.route.js";
import { configAssistantRoute } from "./config-assistant/config-assistant.route.js";
import { supportAssistantRoute } from "./support-assistant/support-assistant.route.js";
import { adminRoute } from "./routes/admin.route.js";
import { aiCorrectionsRoute } from "./ai/corrections.route.js";
import { statsRoute } from "./analytics/stats.route.js";
import { broadcastsRoute } from "./broadcasts/broadcasts.route.js";
import { teamRoute } from "./team/team.route.js";
import { aiSettingsRoute } from "./routes/ai-settings.route.js";
import { aiTestRoute } from "./routes/ai-test.route.js";
import { authRoute, requireAuth } from "./routes/auth.route.js";
import { billingRoute } from "./routes/billing.route.js";
import { conversationsRoute } from "./routes/conversations.route.js";
import { healthRoute } from "./routes/health.route.js";
import { organizationsRoute } from "./routes/organizations.route.js";
import { ordersRoute } from "./orders/orders.route.js";
import { productsRoute } from "./products/products.route.js";
import { routingRoute } from "./lead-routing/lead-routing.route.js";
import { whatsappRoute } from "./routes/whatsapp.route.js";
import { AppError } from "./shared/errors.js";
import { isAllowedForRole } from "./shared/permissions.js";
import { isPublicRoute } from "./shared/public-route.js";
import { restoreWhatsAppConnections } from "./whatsapp/whatsapp.registry.js";

export async function buildServer(options: { restoreConnections?: boolean } = {}) {
  const app = Fastify({
    bodyLimit: 5 * 1024 * 1024,
    logger:
      env.NODE_ENV === "test"
        ? false
        : env.NODE_ENV === "development"
          ? { transport: { target: "pino-pretty" } }
          : true,
  });

  app.addContentTypeParser(/^image\/(jpeg|png|webp)$/, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.addContentTypeParser("application/pdf", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.addContentTypeParser(
    ["application/json", "application/x-www-form-urlencoded"],
    { parseAs: "string" },
    (request, body, done) => {
      if (typeof body !== "string") {
        done(null, {});
        return;
      }

      const rawBody = body.trim();
      if (rawBody === "") {
        done(null, {});
        return;
      }

      try {
        if (request.headers["content-type"]?.includes("application/x-www-form-urlencoded")) {
          done(null, Object.fromEntries(new URLSearchParams(rawBody)));
          return;
        }

        const parsed = JSON.parse(rawBody);
        done(null, parsed);
      } catch (error) {
        const fallback = rawBody.startsWith('"') && rawBody.endsWith('"') ? rawBody.slice(1, -1) : rawBody;

        if (fallback !== rawBody) {
          try {
            done(null, JSON.parse(fallback));
            return;
          } catch {
            // fall through to a controlled 400 from the route validation layer
          }
        }

        done(null, rawBody);
      }
    },
  );

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);

    if (origin && allowedOrigins.includes(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()" );

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }

    if (isPublicRoute(request.url)) {
      return;
    }

    const session = await requireAuth(request.headers.authorization);
    if (!session) {
      reply.code(401).send({ message: "Non autorisé." });
      return;
    }

    if (session.role && !isAllowedForRole(session.role, request.method, request.url)) {
      reply.code(403).send({ message: "Cette action est réservée au propriétaire de l'entreprise." });
      return;
    }

    const organizationMatch = /^\/organizations\/([^/?]+)/.exec(request.url);
    if (organizationMatch && session.organizationId !== organizationMatch[1]) {
      reply.code(403).send({ message: "Accès interdit à cette entreprise." });
      return;
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
      return;
    }

    app.log.error(error);
    reply.status(500).send({
      error: "INTERNAL_ERROR",
      message: "Une erreur inattendue est survenue.",
    });
  });

  await app.register(healthRoute);
  await app.register(adminRoute);
  await app.register(authRoute);
  await app.register(organizationsRoute);
  await app.register(productsRoute);
  await app.register(appointmentsRoute);
  await app.register(ordersRoute);
  await app.register(configAssistantRoute);
  await app.register(supportAssistantRoute);
  await app.register(aiSettingsRoute);
  await app.register(aiTestRoute);
  await app.register(onboardingRoute);
  await app.register(aiCorrectionsRoute);
  await app.register(statsRoute);
  await app.register(broadcastsRoute);
  await app.register(teamRoute);
  await app.register(billingRoute);
  await app.register(routingRoute);
  await app.register(whatsappRoute);
  await app.register(conversationsRoute);

  if (options.restoreConnections !== false) {
    try {
      await restoreWhatsAppConnections();
    } catch (error) {
      app.log.error(error, "Restauration WhatsApp ignorée au démarrage");
    }
  }

  return app;
}

