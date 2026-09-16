import Fastify from "fastify";
import { env } from "./config/env.js";
import { aiSettingsRoute } from "./routes/ai-settings.route.js";
import { authRoute, requireAuth } from "./routes/auth.route.js";
import { conversationsRoute } from "./routes/conversations.route.js";
import { healthRoute } from "./routes/health.route.js";
import { organizationsRoute } from "./routes/organizations.route.js";
import { routingRoute } from "./lead-routing/lead-routing.route.js";
import { whatsappRoute } from "./routes/whatsapp.route.js";
import { AppError } from "./shared/errors.js";
import { restoreWhatsAppConnections } from "./whatsapp/whatsapp.registry.js";

async function buildServer() {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : true,
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
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }

    const isPublicRoute = request.url === "/" || request.url === "/login" || request.url === "/register" || request.url.startsWith("/health");
    if (isPublicRoute) {
      return;
    }

    const session = await requireAuth(request.headers.authorization);
    if (!session) {
      reply.code(401).send({ message: "Non autorisé." });
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
  await app.register(authRoute);
  await app.register(organizationsRoute);
  await app.register(aiSettingsRoute);
  await app.register(routingRoute);
  await app.register(whatsappRoute);
  await app.register(conversationsRoute);

  try {
    await restoreWhatsAppConnections();
  } catch (error) {
    app.log.error(error, "Restauration WhatsApp ignorée au démarrage");
  }

  return app;
}

async function start() {
  const app = await buildServer();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`🚀 Brayano AI backend démarré sur ${env.APP_URL}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
