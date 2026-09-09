import type { FastifyInstance } from "fastify";
import { pingDatabase } from "../database/client.js";

export async function healthRoute(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/health/db", async (_request, reply) => {
    try {
      await pingDatabase();
      return { status: "ok", database: "connected" };
    } catch (error) {
      app.log.error(error);
      reply.status(503);
      return { status: "error", database: "unreachable" };
    }
  });
}
