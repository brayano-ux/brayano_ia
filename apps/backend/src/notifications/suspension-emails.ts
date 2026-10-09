import { env } from "../config/env.js";
import { prisma } from "../database/client.js";
import { isEmailConfigured, sendEmail } from "./email.service.js";

export type SuspensionEmailKind = "suspended" | "reactivated";

/**
 * Résultat de la notification, renvoyé à l'administrateur de la plateforme :
 * - sent : tous les administrateurs de l'entreprise ont reçu l'email
 * - partial : une partie seulement
 * - smtp_not_configured : SMTP_HOST / SMTP_USER / SMTP_PASSWORD / SMTP_FROM manquent
 * - no_admin : aucun compte administrateur rattaché à l'entreprise
 * - failed : l'envoi a échoué pour tous (identifiants SMTP refusés, serveur injoignable…)
 * - pending : l'envoi est encore en cours après le délai d'attente
 */
export type SuspensionNotification = {
  status: "sent" | "partial" | "smtp_not_configured" | "no_admin" | "failed" | "pending";
  sent: number;
  total: number;
};

function buildMessage(kind: SuspensionEmailKind, organizationName: string, reason: string | null) {
  const support = env.SUPPORT_EMAIL ? ` Pour toute question, écrivez-nous à ${env.SUPPORT_EMAIL}.` : "";
  if (kind === "suspended") {
    return {
      subject: "Votre assistant IA a été suspendu",
      text: `Bonjour,\n\nL'assistant IA de ${organizationName} a été suspendu par l'administrateur de la plateforme.${reason ? ` Motif : ${reason}.` : ""}\n\nTant que la suspension dure, l'assistant ne répond plus automatiquement à vos prospects. Les messages continuent d'arriver et vous pouvez y répondre à la main depuis votre tableau de bord.${support}`,
    };
  }
  return {
    subject: "Votre assistant IA est de nouveau actif",
    text: `Bonjour,\n\nLa suspension de l'assistant IA de ${organizationName} a été levée : il répond de nouveau automatiquement à vos prospects.${support}`,
  };
}

/** Prévient les administrateurs de l'entreprise et dit ce qui s'est réellement passé. */
export async function sendSuspensionEmail(organizationId: string, kind: SuspensionEmailKind, reason: string | null): Promise<SuspensionNotification> {
  if (!isEmailConfigured()) {
    console.warn(`[org:${organizationId}] Email de suspension non envoyé : SMTP non configuré (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM).`);
    return { status: "smtp_not_configured", sent: 0, total: 0 };
  }

  const [organization, admins] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    prisma.user.findMany({ where: { organizationId, role: "ADMIN" }, select: { email: true } }),
  ]);
  if (!organization || admins.length === 0) {
    console.warn(`[org:${organizationId}] Email de suspension non envoyé : aucun compte administrateur rattaché à cette entreprise.`);
    return { status: "no_admin", sent: 0, total: 0 };
  }

  const { subject, text } = buildMessage(kind, organization.name, reason);
  let sent = 0;
  for (const admin of admins) {
    try {
      if (await sendEmail({ to: admin.email, subject, text })) sent += 1;
    } catch (error) {
      console.error(`[org:${organizationId}] Email de suspension refusé par le serveur SMTP :`, error);
    }
  }

  const status = sent === 0 ? "failed" : sent === admins.length ? "sent" : "partial";
  console.log(`[org:${organizationId}] Email de suspension (${kind}) : ${sent}/${admins.length} envoyé(s).`);
  return { status, sent, total: admins.length };
}
