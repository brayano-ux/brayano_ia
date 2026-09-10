import Fastify from "fastify";
import { env } from "./config/env.js";
import { aiSettingsRoute } from "./routes/ai-settings.route.js";
import { authRoute, requireAuth } from "./routes/auth.route.js";
import { conversationsRoute } from "./routes/conversations.route.js";
import { healthRoute } from "./routes/health.route.js";
import { organizationsRoute } from "./routes/organizations.route.js";
import { whatsappRoute } from "./routes/whatsapp.route.js";
import { AppError } from "./shared/errors.js";

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
      if (typeof body !== "string" || body.trim() === "") {
        done(null, {});
        return;
      }

      try {
        if (request.headers["content-type"]?.includes("application/x-www-form-urlencoded")) {
          done(null, Object.fromEntries(new URLSearchParams(body)));
          return;
        }

        done(null, JSON.parse(body));
      } catch (error) {
        done(error as Error);
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

    const isPublicRoute = request.url === "/login" || request.url === "/register" || request.url.startsWith("/health");
    if (isPublicRoute) {
      return;
    }

    const session = await requireAuth(request.headers.authorization);
    if (!session) {
      reply.code(401).send({ message: "Non autorisé." });
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
  await app.register(whatsappRoute);
  await app.register(conversationsRoute);

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
