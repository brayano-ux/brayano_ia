import { prisma } from "../database/client.js";
import { sendSuspensionEmail, type SuspensionEmailKind, type SuspensionNotification } from "../notifications/suspension-emails.js";
import { NotFoundError } from "../shared/errors.js";

export type PlatformSuspension = { suspended: boolean; reason: string | null; suspendedAt: Date | null };

/** Suspension décidée par le propriétaire de la plateforme, indépendante du réglage `aiEnabled` du client. */
export async function getPlatformSuspension(organizationId: string): Promise<PlatformSuspension> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { platformSuspended: true, suspensionReason: true, suspendedAt: true },
    });
    return {
      suspended: organization?.platformSuspended ?? false,
      reason: organization?.suspensionReason ?? null,
      suspendedAt: organization?.suspendedAt ?? null,
    };
  } catch (error) {
    // Un problème de base ne doit jamais couper l'IA de toutes les entreprises : on laisse répondre.
    console.error(`[org:${organizationId}] Lecture de la suspension plateforme impossible, IA autorisée par défaut :`, error);
    return { suspended: false, reason: null, suspendedAt: null };
  }
}

async function setSuspension(organizationId: string, data: { platformSuspended: boolean; suspensionReason: string | null; suspendedAt: Date | null }) {
  const updated = await prisma.organization.updateMany({ where: { id: organizationId }, data });
  if (updated.count === 0) throw new NotFoundError("Entreprise introuvable.");
}

async function wasSuspended(organizationId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { platformSuspended: true } });
  if (!organization) throw new NotFoundError("Entreprise introuvable.");
  return organization.platformSuspended;
}

const EMAIL_WAIT_MS = 8000;

/** Envoie l'email et rapporte le résultat, sans jamais faire échouer l'action de l'administrateur. */
async function notifyAdmins(organizationId: string, kind: SuspensionEmailKind, reason: string | null): Promise<SuspensionNotification> {
  const sending = sendSuspensionEmail(organizationId, kind, reason).catch((error): SuspensionNotification => {
    console.error(`[org:${organizationId}] Email de suspension impossible :`, error);
    return { status: "failed", sent: 0, total: 0 };
  });
  const timeout = new Promise<SuspensionNotification>((resolve) => {
    setTimeout(() => resolve({ status: "pending", sent: 0, total: 0 }), EMAIL_WAIT_MS).unref?.();
  });
  return Promise.race([sending, timeout]);
}

/** `notification` vaut null quand l'état n'a pas changé (aucun email n'est alors envoyé). */
export async function suspendOrganization(organizationId: string, reason: string | null): Promise<{ notification: SuspensionNotification | null }> {
  const alreadySuspended = await wasSuspended(organizationId);
  await setSuspension(organizationId, { platformSuspended: true, suspensionReason: reason, suspendedAt: new Date() });
  return { notification: alreadySuspended ? null : await notifyAdmins(organizationId, "suspended", reason) };
}

export async function unsuspendOrganization(organizationId: string): Promise<{ notification: SuspensionNotification | null }> {
  const alreadySuspended = await wasSuspended(organizationId);
  await setSuspension(organizationId, { platformSuspended: false, suspensionReason: null, suspendedAt: null });
  return { notification: alreadySuspended ? await notifyAdmins(organizationId, "reactivated", null) : null };
}

export async function listOrganizationsForAdmin() {
  return prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      platformSuspended: true,
      suspensionReason: true,
      suspendedAt: true,
      aiSettings: { select: { aiEnabled: true } },
      whatsappAccounts: {
        select: { status: true, phoneNumber: true, updatedAt: true, lastConnectedAt: true, lastDisconnectedAt: true, lastDisconnectReason: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });
}
