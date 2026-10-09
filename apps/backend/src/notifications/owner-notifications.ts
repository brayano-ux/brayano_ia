import { env } from "../config/env.js";
import { prisma } from "../database/client.js";
import { isEmailConfigured, sendEmail } from "./email.service.js";

export interface ProspectInfo {
  name?: string | null | undefined;
  phone?: string | null | undefined;
}

/** Chaque ligne « libellé : valeur » ; les valeurs vides sont omises. */
function lines(entries: Array<[string, string | null | undefined]>) {
  return entries.filter(([, value]) => value && value.trim()).map(([label, value]) => `${label} : ${value}`).join("\n");
}

function prospectBlock(prospect: ProspectInfo) {
  return lines([
    ["Nom", prospect.name],
    ["WhatsApp / téléphone", prospect.phone ? `+${prospect.phone.replace(/^\+/, "")}` : null],
  ]);
}

function footer() {
  return env.CLIENT_DASHBOARD_URL ? `\n\nOuvrez votre tableau de bord : ${env.CLIENT_DASHBOARD_URL}` : "";
}

export function buildOrderEmail(input: {
  organizationName: string;
  prospect: ProspectInfo;
  items: Array<{ quantity: number; name: string; unitPrice: string | null }>;
  totalLabel: string | null;
  address: string;
  notes: string | null;
}) {
  const items = input.items
    .map((item) => `• ${item.quantity} × ${item.name}${item.unitPrice ? ` (${item.unitPrice})` : ""}`)
    .join("\n");
  return {
    subject: `🛒 Nouvelle commande — ${input.prospect.name || "client WhatsApp"}`,
    text: `Bonjour,\n\nL'assistant IA de ${input.organizationName} vient d'enregistrer une nouvelle commande.\n\nCLIENT\n${prospectBlock(input.prospect)}\n\nCOMMANDE\n${items}${input.totalLabel ? `\nTotal : ${input.totalLabel}` : ""}\n\nLIVRAISON\n${input.address}${input.notes ? `\n\nNOTES\n${input.notes}` : ""}${footer()}`,
  };
}

export function buildAppointmentEmail(input: {
  organizationName: string;
  kind: "booked" | "rescheduled" | "cancelled";
  prospect: ProspectInfo;
  whenLabel: string | null;
  service: string | null;
}) {
  const title = { booked: "Nouveau rendez-vous", rescheduled: "Rendez-vous déplacé", cancelled: "Rendez-vous annulé" }[input.kind];
  return {
    subject: `📅 ${title} — ${input.prospect.name || "client WhatsApp"}`,
    text: `Bonjour,\n\nL'assistant IA de ${input.organizationName} signale : ${title.toLowerCase()}.\n\nCLIENT\n${prospectBlock(input.prospect)}\n\nRENDEZ-VOUS\n${lines([["Date et heure", input.whenLabel], ["Service", input.service]])}${footer()}`,
  };
}

/**
 * Envoie un email à tous les administrateurs de l'entreprise.
 * Ne lève jamais : une notification ne doit jamais perturber la conversation WhatsApp.
 */
export async function notifyOrganizationAdmins(
  organizationId: string,
  build: (organizationName: string) => { subject: string; text: string },
): Promise<void> {
  try {
    if (!isEmailConfigured()) {
      console.warn(`[org:${organizationId}] Notification propriétaire non envoyée : SMTP non configuré.`);
      return;
    }
    const [organization, admins] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      prisma.user.findMany({ where: { organizationId, role: "ADMIN" }, select: { email: true } }),
    ]);
    if (!organization || admins.length === 0) return;
    const { subject, text } = build(organization.name);
    for (const admin of admins) {
      try {
        await sendEmail({ to: admin.email, subject, text });
      } catch (error) {
        console.error(`[org:${organizationId}] Notification refusée par le serveur SMTP :`, error);
      }
    }
  } catch (error) {
    console.error(`[org:${organizationId}] Notification propriétaire ignorée :`, error);
  }
}
