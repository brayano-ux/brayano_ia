import { env } from "../config/env.js";
import { prisma } from "../database/client.js";
import { notifyOrganizationAdmins } from "./owner-notifications.js";

/**
 * Rappels par email aux propriétaires qui ont créé leur compte sans jamais relier leur WhatsApp : sans cette étape,
 * l'agent ne peut répondre à personne et le compte reste inutile. Trois rappels au plus (1, 3 puis 7 jours après
 * l'inscription), seulement en journée, et plus aucun dès que le numéro a été relié une seule fois.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Moment de chaque rappel après l'inscription. */
export const REMINDER_STEPS_MS = [1 * DAY, 3 * DAY, 7 * DAY] as const;
/**
 * Un rappel n'est envoyé que dans les jours qui suivent son échéance : un compte ancien (créé avant cette fonction,
 * ou dont un rappel a été manqué pendant une panne) ne reçoit pas une rafale d'emails d'un coup.
 */
export const REMINDER_WINDOW_MS = 4 * DAY;
/** Heures d'envoi, heure du Cameroun : pas d'email au milieu de la nuit. */
export const SEND_HOURS = { from: 8, to: 20, timezone: "Africa/Douala" } as const;

/** Numéro du rappel à envoyer maintenant (1, 2 ou 3), ou null. */
export function dueReminderStep(accountAgeMs: number, alreadySent: number): number | null {
  for (let index = REMINDER_STEPS_MS.length - 1; index >= 0; index -= 1) {
    const at = REMINDER_STEPS_MS[index]!;
    if (accountAgeMs < at) continue;
    const step = index + 1;
    return accountAgeMs < at + REMINDER_WINDOW_MS && alreadySent < step ? step : null;
  }
  return null;
}

export function isDaytime(now: Date): boolean {
  // formatToParts : seul le nombre (« 10 h » en français ferait échouer une simple conversion).
  const part = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: SEND_HOURS.timezone }).formatToParts(now).find((item) => item.type === "hour");
  const hour = Number(part?.value);
  return hour >= SEND_HOURS.from && hour < SEND_HOURS.to;
}

const SUPPORT_WHATSAPP = "+237 683 26 05 20";

export function buildWhatsAppConnectReminderEmail(input: { organizationName: string; step: number }) {
  const url = env.CLIENT_DASHBOARD_URL ? env.CLIENT_DASHBOARD_URL.replace(/\/+$/, "") : null;
  const howTo = [
    "Comment faire (2 minutes) :",
    "1. Ouvrez votre tableau de bord, page « WhatsApp », puis cliquez sur « Afficher le QR code ».",
    "2. Sur le téléphone de l'entreprise : WhatsApp → menu → Appareils connectés → Connecter un appareil.",
    "3. Scannez le QR code affiché. Vous n'avez qu'un téléphone ? Choisissez « Utiliser un code d'association ».",
    "",
    "Vous gardez votre numéro et votre téléphone, comme avec WhatsApp Web.",
  ].join("\n");
  const link = url ? `\n\nOuvrir mon tableau de bord : ${url}` : "";
  const help = `\n\nBesoin d'aide ? Écrivez-nous sur WhatsApp au ${SUPPORT_WHATSAPP}, nous vous guidons.`;

  if (input.step === 1) {
    return {
      subject: `Dernière étape : reliez le WhatsApp de ${input.organizationName}`,
      text: `Bonjour,\n\nVotre espace Brayano IA pour ${input.organizationName} est prêt, mais votre numéro WhatsApp n'est pas encore relié. Tant que ce n'est pas fait, votre assistant ne peut répondre à aucun client.\n\n${howTo}${link}${help}`,
    };
  }
  if (input.step === 2) {
    return {
      subject: `Vos clients vous écrivent : votre assistant attend votre WhatsApp`,
      text: `Bonjour,\n\nVos 100 réponses offertes sont toujours disponibles pour ${input.organizationName}. Il ne manque qu'une chose pour que votre assistant réponde à vos clients jour et nuit : relier votre numéro WhatsApp.\n\n${howTo}${link}${help}`,
    };
  }
  return {
    subject: `Dernier rappel : votre assistant WhatsApp n'est pas encore actif`,
    text: `Bonjour,\n\nVotre assistant Brayano IA pour ${input.organizationName} n'a pas encore été relié à votre WhatsApp, et vos 100 réponses offertes vous attendent toujours.\n\nSi quelque chose vous bloque (QR code qui ne s'affiche pas, un seul téléphone, numéro WhatsApp Business…), répondez simplement à notre support sur WhatsApp au ${SUPPORT_WHATSAPP} : nous vous aidons à le faire en quelques minutes.\n\n${howTo}${link}\n\nC'est le dernier rappel que nous vous envoyons à ce sujet.`,
  };
}

export interface ReminderDeps {
  now?: Date;
  notify?: typeof notifyOrganizationAdmins;
}

/** Envoie les rappels dus. Renvoie le nombre d'entreprises prévenues. Ne lève jamais. */
export async function runWhatsAppConnectReminders(deps: ReminderDeps = {}): Promise<number> {
  const now = deps.now ?? new Date();
  const notify = deps.notify ?? notifyOrganizationAdmins;
  if (!isDaytime(now)) return 0;

  const lastStep = REMINDER_STEPS_MS.length;
  const oldest = new Date(now.getTime() - (REMINDER_STEPS_MS[lastStep - 1]! + REMINDER_WINDOW_MS));
  const youngest = new Date(now.getTime() - REMINDER_STEPS_MS[0]);

  const candidates = await prisma.organization.findMany({
    where: {
      createdAt: { gte: oldest, lte: youngest },
      whatsappReminderCount: { lt: lastStep },
      platformSuspended: false,
      users: { some: { role: "ADMIN", active: true } },
      // Un numéro relié une seule fois suffit : l'entreprise a fait l'étape, une déconnexion a ses propres alertes.
      whatsappAccounts: { none: { OR: [{ status: "CONNECTED" }, { lastConnectedAt: { not: null } }] } },
    },
    select: { id: true, createdAt: true, whatsappReminderCount: true },
    take: 200,
  });

  let sent = 0;
  for (const organization of candidates) {
    const step = dueReminderStep(now.getTime() - organization.createdAt.getTime(), organization.whatsappReminderCount);
    if (!step) continue;
    try {
      // On « réserve » le rappel avant d'envoyer : deux passages simultanés n'envoient jamais deux fois le même.
      const claimed = await prisma.organization.updateMany({
        where: { id: organization.id, whatsappReminderCount: organization.whatsappReminderCount },
        data: { whatsappReminderCount: step, whatsappReminderAt: now },
      });
      if (claimed.count !== 1) continue;
      await notify(organization.id, (organizationName) => buildWhatsAppConnectReminderEmail({ organizationName, step }));
      sent += 1;
    } catch (error) {
      console.error(`❌ [org:${organization.id}] Rappel « connectez votre WhatsApp » non envoyé :`, error);
    }
  }
  return sent;
}
