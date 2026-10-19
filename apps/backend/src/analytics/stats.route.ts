import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { getDashboardStats } from "./stats.service.js";

const querySchema = z.object({ days: z.coerce.number().refine((value) => value === 1 || value === 7 || value === 30, "Période invalide.").default(7) });

export async function statsRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/stats", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    return { stats: await getDashboardStats(orgId, parsed.data.days as 1 | 7 | 30) };
  });
}
