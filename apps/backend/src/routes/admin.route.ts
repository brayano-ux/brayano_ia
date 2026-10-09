import type { FastifyInstance } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  listOrganizationsForAdmin,
  suspendOrganization,
  unsuspendOrganization,
} from "../organizations/platform-suspension.service.js";
import { getPlatformAdminEmails } from "../organizations/platform-admins.js";
import { ValidationError } from "../shared/errors.js";
import { getWhatsAppAccountStatus } from "../whatsapp/whatsapp.registry.js";
import { requireAuth } from "./auth.route.js";

const suspendSchema = z.object({ reason: z.string().trim().max(300).optional() });

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

export { getPlatformAdminEmails };

export function isValidPlatformAdminToken(authorization: string | undefined) {
  const expected = env.PLATFORM_ADMIN_TOKEN;
  if (!expected) return false;
  const provided = /^Bearer (.+)$/.exec(authorization ?? "")?.[1];
  if (!provided) return false;
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/**
 * Routes réservées au propriétaire de la plateforme. Accès par la session d'un
 * compte listé dans PLATFORM_ADMIN_EMAILS (connexion habituelle), ou par le
 * PLATFORM_ADMIN_TOKEN s'il est défini. Aucun autre compte d'entreprise n'y accède.
 */
export async function adminRoute(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    if (isValidPlatformAdminToken(request.headers.authorization)) return;

    const adminEmails = getPlatformAdminEmails();
    if (adminEmails.length === 0 && !env.PLATFORM_ADMIN_TOKEN) {
      reply.code(503).send({ message: "Administration plateforme désactivée : aucun administrateur configuré (PLATFORM_ADMIN_EMAILS)." });
      return;
    }

    const session = await requireAuth(request.headers.authorization);
    if (!session) {
      reply.code(401).send({ message: "Non autorisé." });
      return;
    }
    if (!adminEmails.includes(session.email.trim().toLowerCase())) {
      reply.code(403).send({ message: "Ce compte n'est pas administrateur de la plateforme." });
    }
  });

  app.get("/admin/organizations", async () => {
    const organizations = await listOrganizationsForAdmin();
    return {
      organizations: organizations.map(({ whatsappAccounts, ...organization }) => ({
        ...organization,
        // État en direct du serveur (la base peut dater d'avant un redémarrage).
        whatsapp: {
          status: getWhatsAppAccountStatus(organization.id),
          phoneNumber: whatsappAccounts[0]?.phoneNumber ?? null,
          updatedAt: whatsappAccounts[0]?.updatedAt ?? null,
          lastConnectedAt: whatsappAccounts[0]?.lastConnectedAt ?? null,
          lastDisconnectedAt: whatsappAccounts[0]?.lastDisconnectedAt ?? null,
          lastDisconnectReason: whatsappAccounts[0]?.lastDisconnectReason ?? null,
        },
      })),
    };
  });

  app.post("/admin/organizations/:orgId/suspend", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = suspendSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message);
    const { notification } = await suspendOrganization(orgId, parsed.data.reason || null);
    return { organizationId: orgId, platformSuspended: true, notification };
  });

  app.post("/admin/organizations/:orgId/unsuspend", async (request) => {
    const { orgId } = request.params as { orgId: string };
    const { notification } = await unsuspendOrganization(orgId);
    return { organizationId: orgId, platformSuspended: false, notification };
  });
}
