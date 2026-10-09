import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { getOrderSettings, listOrders, orderStatusSchema, updateOrderSettings, updateOrderStatus } from "./orders.service.js";

export async function ordersRoute(app: FastifyInstance) {
  app.get("/organizations/:orgId/orders/settings", async (request) => {
    const { orgId } = request.params as { orgId: string };
    return { settings: await getOrderSettings(orgId) };
  });

  app.put("/organizations/:orgId/orders/settings", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Réglage invalide.");
    return { settings: await updateOrderSettings(orgId, parsed.data) };
  });

  app.get("/organizations/:orgId/orders", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = z.object({ status: orderStatusSchema.optional() }).safeParse(request.query ?? {});
    if (!parsed.success) throw new ValidationError("Filtre invalide.");
    return { orders: await listOrders(orgId, parsed.data.status) };
  });

  app.put("/organizations/:orgId/orders/:orderId", async (request) => {
    const { orgId, orderId } = request.params as { orgId: string; orderId: string };
    const parsed = z.object({ status: orderStatusSchema }).safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Statut invalide.");
    return { order: await updateOrderStatus(orgId, orderId, parsed.data.status) };
  });
}
