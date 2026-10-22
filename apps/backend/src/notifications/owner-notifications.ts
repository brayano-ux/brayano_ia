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

/**
 * `cancelled` : l'IA a annulé une commande encore « Nouvelle ».
 * `requested` : le client demande d'annuler une commande déjà confirmée/livrée → action du propriétaire.
 */
export function buildOrderCancellationEmail(input: {
  organizationName: string;
  kind: "cancelled" | "requested";
  prospect: ProspectInfo;
  items: Array<{ quantity: number; name: string }>;
  totalLabel: string | null;
}) {
  const items = input.items.map((item) => `• ${item.quantity} × ${item.name}`).join("\n");
  const who = input.prospect.name || "client WhatsApp";
  const intro = input.kind === "cancelled"
    ? `L'assistant IA de ${input.organizationName} a annulé une commande à la demande du client (elle n'était pas encore confirmée).`
    : `Un client de ${input.organizationName} demande l'annulation d'une commande déjà confirmée ou livrée. L'assistant IA n'a pas pu l'annuler : c'est à vous de la traiter.`;
  return {
    subject: input.kind === "cancelled" ? `🛒 Commande annulée — ${who}` : `⚠️ Demande d'annulation de commande — ${who}`,
    text: `Bonjour,\n\n${intro}\n\nCLIENT\n${prospectBlock(input.prospect)}\n\nCOMMANDE\n${items}${input.totalLabel ? `\nTotal : ${input.totalLabel}` : ""}${footer()}`,
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


const HANDOFF_REASONS: Record<string, string> = {
  demande_contact_humain: "Le client demande à parler à une personne.",
  reclamation: "Le client a une réclamation ou un problème à régler.",
  achat: "Le client semble prêt à acheter.",
  demande_commande: "Le client veut passer commande.",
  demande_paiement: "Le client pose une question sur le paiement.",
  demande_livraison: "Le client pose une question sur la livraison.",
  demande_inscription: "Le client veut s'inscrire.",
  erreur_traitement: "L'assistant n'a pas pu traiter ce message (erreur technique).",
};

export function describeHandoffReason(intent: string | null | undefined): string {
  return (intent && HANDOFF_REASONS[intent]) || "L'assistant a jugé qu'une personne de l'équipe devait répondre.";
}

/**
 * L'IA passe la main : le propriétaire doit répondre lui-même. Le client attend — l'email doit être clair et rapide à lire.
 */
export function buildHandoffEmail(input: {
  organizationName: string;
  prospect: ProspectInfo;
  intent: string | null | undefined;
  recent: Array<{ author: "CONTACT" | "AI" | "HUMAN"; text: string }>;
  leadData?: Record<string, unknown> | null;
}) {
  const who = input.prospect.name || "un client WhatsApp";
  const authorLabel = { CONTACT: "Client", AI: "Assistant", HUMAN: "Vous" } as const;
  const excerpt = input.recent
    .slice(-4)
    .map((message) => `${authorLabel[message.author]} : ${message.text.replace(/\s+/g, " ").trim().slice(0, 240)}`)
    .join("\n");
  const known = Object.entries(input.leadData ?? {})
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([field, value]) => `${field} : ${String(value).trim()}`)
    .join("\n");
  return {
    subject: `🙋 ${who} attend votre réponse`,
    text: `Bonjour,\n\nL'assistant IA de ${input.organizationName} a passé la main : ${describeHandoffReason(input.intent)}\nL'IA est en pause pour cette conversation. Répondez depuis votre téléphone ou depuis l'onglet Conversations de votre tableau de bord.\n\nCLIENT\n${prospectBlock(input.prospect)}${known ? `\n\nINFORMATIONS RECUEILLIES\n${known}` : ""}\n\nDERNIERS MESSAGES\n${excerpt || "(aucun message)"}${footer()}`,
  };
}

/** Un client a envoyé une photo ou un document : l'IA ne peut pas le vérifier à la place du propriétaire. */
export function buildMediaReceivedEmail(input: {
  organizationName: string;
  prospect: ProspectInfo;
  kind: "payment_proof" | "product_photo" | "document" | "other";
  fileLabel: string;
  caption: string | null;
  summary: string | null;
}) {
  const who = input.prospect.name || "un client WhatsApp";
  const title = {
    payment_proof: "💳 Preuve de paiement reçue — à vérifier",
    product_photo: "📷 Photo de produit reçue",
    document: "📎 Document reçu",
    other: "📷 Photo reçue",
  }[input.kind];
  const warning = input.kind === "payment_proof"
    ? "\nL'assistant n'a PAS confirmé le paiement au client : vérifiez votre solde Mobile Money / votre compte avant de livrer.\n"
    : "";
  return {
    subject: `${title} — ${who}`,
    text: `Bonjour,\n\nUn client de ${input.organizationName} vient d'envoyer ${input.fileLabel}.${warning}\nCLIENT\n${prospectBlock(input.prospect)}${input.caption ? `\n\nMESSAGE DU CLIENT\n${input.caption}` : ""}${input.summary ? `\n\nCE QUE L'ASSISTANT A REMARQUÉ\n${input.summary}` : ""}\n\nOuvrez la conversation dans l'onglet Conversations pour voir le fichier.${footer()}`,
  };
}

/** L'assistant ne peut plus répondre : plus de messages dans le forfait (ou essai terminé, abonnement expiré). */
export function buildQuotaReachedEmail(input: { organizationName: string; reason: "trial_exhausted" | "subscription_expired" | "message_quota_exhausted" }) {
  const what = {
    trial_exhausted: { subject: "⚠️ Votre essai gratuit est terminé : l'assistant ne répond plus", line: "Votre essai gratuit (100 messages de l'assistant) est terminé." },
    message_quota_exhausted: { subject: "⚠️ Vous avez utilisé tous les messages de votre forfait : l'assistant ne répond plus", line: "Vous avez utilisé tous les messages de l'assistant inclus dans votre forfait pour cette période." },
    subscription_expired: { subject: "⚠️ Votre abonnement est terminé : l'assistant ne répond plus", line: "Votre abonnement est arrivé à son terme." },
  }[input.reason];
  const url = env.CLIENT_DASHBOARD_URL ? env.CLIENT_DASHBOARD_URL.replace(/\/+$/, "") : null;
  return {
    subject: what.subject,
    text: `Bonjour,\n\n${what.line} L'assistant de ${input.organizationName} ne répond donc plus automatiquement à vos clients.\n\nVos clients peuvent toujours vous écrire et vous pouvez leur répondre vous-même depuis l'onglet Conversations de votre tableau de bord.\n\nPour réactiver l'assistant, ouvrez la page « Mon forfait » et choisissez un forfait.${url ? `\n\nMon forfait : ${url}` : ""}\n\nNous vous envoyons ce message une fois par jour au maximum.`,
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
