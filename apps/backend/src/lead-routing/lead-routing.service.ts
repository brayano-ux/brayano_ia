import { prisma } from "../database/client.js";

export type RoutingConsent = "unknown" | "granted" | "refused";

export type LeadQualificationResult = {
  isQualified: boolean;
  minimumScore: number;
  score: number;
  missingFields: string[];
  cityConfidence: "high" | "medium" | "low";
};

export type LeadRoutingOutcome = {
  routed: boolean;
  routeType: "location" | "fallback" | "none";
  locationId?: string;
  responsibleId?: string;
  responsibleWhatsapp?: string;
  reason?: string;
};

export function normalizeCityName(value?: string | null): string | null {
  if (!value || typeof value !== "string") return null;

  const cleaned = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  const cityPatterns = [
    "douala",
    "yaounde",
    "yaoundé",
    "bafoussam",
    "limbe",
    "kribi",
    "buea",
    "bamenda",
    "ngaoundere",
    "maroua",
    "bertoua",
    "garoua",
    "nkongsamba",
  ];

  for (const city of cityPatterns) {
    if (cleaned.includes(city)) return city;
  }

  const words = cleaned.split(" ");
  const cityWord = words.find((word) => word.length > 2 && !["je", "suis", "a", "dans", "cameroun", "ville"].includes(word));
  return cityWord ?? cleaned;
}

export function resolveLeadQualification(lead: Record<string, unknown>, configuredFields: string[] = []): LeadQualificationResult {
  const required = configuredFields.length ? configuredFields : ["name", "city", "need"];
  const missingFields: string[] = [];

  let score = 0;

  const fieldScores: Record<string, number> = { name: 30, city: 25, need: 25, budget: 10, product: 10, urgency: 5 };
  for (const field of required) {
    if (typeof lead[field] === "string" && String(lead[field]).trim()) {
      score += fieldScores[field] ?? 15;
    } else {
      missingFields.push(field);
    }
  }

  for (const field of Object.keys(fieldScores)) {
    if (!required.includes(field) && typeof lead[field] === "string" && String(lead[field]).trim()) score += fieldScores[field] ?? 0;
  }

  const isQualified = configuredFields.length > 0
    ? missingFields.length === 0
    : score >= 70 && missingFields.length === 0;

  return {
    isQualified,
    minimumScore: 70,
    score,
    missingFields,
    cityConfidence: typeof lead.city === "string" && lead.city.trim() ? "high" : "low",
  };
}

export async function listLocations(organizationId: string) {
  return prisma.location.findMany({
    where: { organizationId },
    include: { responsible: { where: { active: true }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
}

export async function createLocation(
  organizationId: string,
  input: { name: string; city: string; recipientWhatsApp?: string | null | undefined; active?: boolean | undefined },
) {
  return prisma.location.create({
    data: {
      organizationId,
      name: input.name.trim(),
      city: input.city.trim(),
      recipientWhatsApp: input.recipientWhatsApp?.trim() || null,
      active: input.active ?? true,
    },
  });
}

export async function listResponsiblesForLocation(organizationId: string, locationId: string) {
  return prisma.responsible.findMany({
    where: { organizationId, locationId },
    orderBy: { name: "asc" },
  });
}

export async function createResponsible(
  organizationId: string,
  input: { locationId: string; name: string; whatsappNumber: string; active?: boolean | undefined },
) {
  const location = await prisma.location.findFirst({ where: { id: input.locationId, organizationId } });
  if (!location) {
    throw new Error("Zone introuvable pour cette organisation.");
  }

  return prisma.responsible.create({
    data: {
      organizationId,
      locationId: input.locationId,
      name: input.name.trim(),
      whatsappNumber: input.whatsappNumber.trim(),
      active: input.active ?? true,
    },
  });
}

export async function getRoutingSettings(organizationId: string) {
  return prisma.organizationRoutingSettings.upsert({
    where: { organizationId },
    create: { organizationId, active: true },
    update: {},
    include: { fallbackResponsible: true },
  });
}

export async function setRoutingFallback(
  organizationId: string,
  input: { fallbackResponsibleId?: string | null | undefined; fallbackWhatsApp?: string | null | undefined; active?: boolean | undefined },
) {
  const fallbackResponsibleId = input.fallbackResponsibleId ?? null;
  if (fallbackResponsibleId) {
    const responsible = await prisma.responsible.findFirst({ where: { id: fallbackResponsibleId, organizationId } });
    if (!responsible) {
      throw new Error("Responsable de fallback introuvable pour cette organisation.");
    }
  }

  return prisma.organizationRoutingSettings.upsert({
    where: { organizationId },
    update: {
      fallbackResponsibleId,
      fallbackWhatsApp: input.fallbackWhatsApp?.trim() || null,
      active: input.active ?? true,
    },
    create: {
      organizationId,
      fallbackResponsibleId,
      fallbackWhatsApp: input.fallbackWhatsApp?.trim() || null,
      active: input.active ?? true,
    },
    include: { fallbackResponsible: true },
  });
}

export async function getOrganizationRoutingTargets(organizationId: string) {
  return prisma.location.findMany({
    where: { organizationId, active: true },
    include: { responsible: { where: { active: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getCommercialMetrics(organizationId: string) {
  const responsibles = await prisma.responsible.findMany({
    where: { organizationId, active: true },
    include: { location: true },
    orderBy: { name: "asc" },
  });

  if (!responsibles.length) {
    return [];
  }

  const conversations = await prisma.conversation.findMany({
    where: { organizationId },
    include: {
      messages: {
        where: { direction: "INBOUND" },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const byResponsible = new Map<string, { total: number; byDay: Record<string, number> }>();
  for (const responsible of responsibles) {
    byResponsible.set(responsible.id, { total: 0, byDay: {} });
  }

  const leadAssignments = await prisma.prospectLead.findMany({
    where: { organizationId, responsibleId: { not: null } },
    select: { responsibleId: true, conversationId: true, createdAt: true },
  });

  const responsibleConversationMap = new Map<string, string[]>();

  for (const assignment of leadAssignments) {
    if (!assignment.responsibleId || !assignment.conversationId) continue;
    const current = responsibleConversationMap.get(assignment.responsibleId) ?? [];
    current.push(assignment.conversationId);
    responsibleConversationMap.set(assignment.responsibleId, current);
  }

  const activeConversations = conversations.filter((conversation) => conversation.messages.length > 0);

  for (const conversation of activeConversations) {
    const inboundMessages = conversation.messages;
    if (!inboundMessages.length) continue;

    const relatedResponsibleIds = [...responsibleConversationMap.entries()]
      .filter(([, ids]) => ids.includes(conversation.id))
      .map(([responsibleId]) => responsibleId);

    const targets = relatedResponsibleIds
      .map((id) => responsibles.find((responsible) => responsible.id === id))
      .filter(Boolean) as typeof responsibles;
    if (!targets.length) continue;

    const countPerResponsible = Math.max(1, Math.floor(inboundMessages.length / Math.max(1, targets.length)));
    const remainder = inboundMessages.length % Math.max(1, targets.length);

    for (const [index, responsible] of targets.entries()) {
      const stats = byResponsible.get(responsible.id) ?? { total: 0, byDay: {} };
      const day = inboundMessages[0]?.createdAt ? new Date(inboundMessages[0].createdAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const amount = countPerResponsible + (index < remainder ? 1 : 0);
      stats.total += amount;
      stats.byDay[day] = (stats.byDay[day] ?? 0) + amount;
      byResponsible.set(responsible.id, stats);
    }
  }

  return responsibles.map((responsible) => {
    const stats = byResponsible.get(responsible.id) ?? { total: 0, byDay: {} };
    const byDayEntries = Object.entries(stats.byDay).sort(([a], [b]) => b.localeCompare(a));

    return {
      id: responsible.id,
      name: responsible.name,
      whatsappNumber: responsible.whatsappNumber,
      locationName: responsible.location?.name ?? "Zone principale",
      totalMessages: stats.total,
      messagesByDay: byDayEntries.map(([day, count]) => ({ day, count })),
    };
  });
}

export async function resolveRoutingForLead(organizationId: string, city?: string | null): Promise<LeadRoutingOutcome> {
  const normalizedCity = normalizeCityName(city ?? null);

  if (!normalizedCity) {
    const outcome = { routed: false, routeType: "none", reason: "Ville absente ou non identifiable." };
    console.log(`[route:${organizationId}] Ville non identifiable pour le routage`, { rawCity: city, normalizedCity, outcome });
    return outcome;
  }

  const locations = await getOrganizationRoutingTargets(organizationId);
  const exactMatch = locations.find((location) => normalizeCityName(location.city) === normalizedCity);

  if (exactMatch?.responsible?.[0]) {
    const responsible = exactMatch.responsible[0];
    const outcome = {
      routed: true,
      routeType: "location",
      locationId: exactMatch.id,
      responsibleId: responsible.id,
      responsibleWhatsapp: responsible.whatsappNumber ?? undefined,
      reason: `Location détectée pour ${normalizedCity}`,
    };
    console.log(`[route:${organizationId}] Responsable trouvé par ville`, {
      rawCity: city,
      normalizedCity,
      locationId: exactMatch.id,
      locationName: exactMatch.name,
      responsibleId: responsible.id,
      responsibleName: responsible.name,
      responsibleWhatsapp: responsible.whatsappNumber,
      outcome,
    });
    return outcome;
  }

  const settings = await getRoutingSettings(organizationId);
  if (settings?.fallbackResponsible?.whatsappNumber || settings?.fallbackWhatsApp) {
    const fallbackPhone = settings.fallbackResponsible?.whatsappNumber ?? settings.fallbackWhatsApp ?? "";
    const outcome = {
      routed: true,
      routeType: "fallback",
      ...(settings.fallbackResponsible?.id ? { responsibleId: settings.fallbackResponsible.id } : {}),
      responsibleWhatsapp: fallbackPhone,
      reason: `Fallback configuré pour ${normalizedCity}`,
    };
    console.log(`[route:${organizationId}] Fallback utilisé pour le routage`, {
      rawCity: city,
      normalizedCity,
      fallbackResponsibleId: settings.fallbackResponsible?.id,
      fallbackResponsibleName: settings.fallbackResponsible?.name,
      fallbackWhatsApp: settings.fallbackWhatsApp,
      outcome,
    });
    return outcome;
  }

  const outcome = { routed: false, routeType: "none", reason: `Aucune localisation correspondante pour ${normalizedCity}` };
  console.log(`[route:${organizationId}] Aucune route trouvée pour la ville`, {
    rawCity: city,
    normalizedCity,
    locationsCount: locations.length,
    outcome,
  });
  return outcome;
}

export async function registerQualifiedLead(input: {
  organizationId: string;
  conversationId: string;
  leadData?: Record<string, unknown> | null;
  leadScore?: number;
  requiredFields?: string[];
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    include: { contact: true },
  });

  if (!conversation || conversation.organizationId !== input.organizationId) {
    return null;
  }

  const readLeadValue = (...keys: string[]) => {
    for (const key of keys) {
      const value = input.leadData?.[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return undefined;
  };

  const leadPayload = {
    name: readLeadValue("name", "nom") ?? conversation.contact.displayName,
    city: readLeadValue("city", "ville", "location"),
    need: readLeadValue("need", "besoin"),
    budget: readLeadValue("budget"),
    product: readLeadValue("product", "produit", "formation"),
    urgency: readLeadValue("urgency", "urgence"),
  };

  const qualification = resolveLeadQualification(
    { ...(input.leadData ?? {}), ...leadPayload } as Record<string, unknown>,
    input.requiredFields ?? [],
  );
  const whatsappNumber = conversation.contact.whatsappJid;

  const existingLead = await prisma.prospectLead.findFirst({
    where: { organizationId: input.organizationId, conversationId: input.conversationId },
    orderBy: { createdAt: "desc" },
  });

  const payload = {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    contactName: leadPayload.name ?? conversation.contact.displayName ?? null,
    whatsappNumber,
    city: leadPayload.city ?? null,
    need: leadPayload.need ?? null,
    budget: leadPayload.budget ?? null,
    product: leadPayload.product ?? null,
    urgency: leadPayload.urgency ?? null,
    leadScore: input.leadScore ?? 0,
    leadData: input.leadData ? JSON.parse(JSON.stringify(input.leadData)) : null,
    status: (qualification.isQualified ? "QUALIFIED" : "QUALIFYING") as "QUALIFIED" | "QUALIFYING",
    isRouted: false,
    routeStatus: "PENDING" as const,
  };

  const lead = existingLead
    ? await prisma.prospectLead.update({
        where: { id: existingLead.id },
        data: payload,
      })
    : await prisma.prospectLead.create({ data: payload });

  if (!qualification.isQualified) {
    return lead;
  }

  const routingResult = await resolveRoutingForLead(input.organizationId, lead.city ?? undefined);
  if (!routingResult.routed || !routingResult.responsibleWhatsapp) {
    await prisma.prospectLead.update({
      where: { id: lead.id },
      data: {
        status: "QUALIFIED",
          routeStatus: "FAILED" as const,
        isRouted: false,
      },
    });
    return lead;
  }

  const responsible = await prisma.responsible.findFirst({
    where: { id: routingResult.responsibleId ?? "" },
  });

  const location = routingResult.locationId ? await prisma.location.findUnique({ where: { id: routingResult.locationId } }) : null;

  const notificationMessage = [
    "🔔 NOUVEAU PROSPECT QUALIFIÉ",
    "",
    `👤 Nom : ${lead.contactName ?? "Non renseigné"}`,
    `📞 WhatsApp : ${lead.whatsappNumber}`,
    `📍 Ville : ${lead.city ?? "Non renseignée"}`,
    "",
    `🛍️ Besoin : ${lead.need ?? "Non renseigné"}`,
    `💰 Budget : ${lead.budget ?? "Non renseigné"}`,
    `📊 Score : ${lead.leadScore}/100`,
    "",
    "🤖 Prospect qualifié par Brayano AI.",
    "👉 Contactez rapidement le prospect pour poursuivre la vente.",
  ].join("\n");

  try {
    const { sendWhatsAppMessageForOrg } = await import("../whatsapp/whatsapp.registry.js");
    console.log(`[route:${input.organizationId}] Envoi notification au responsable`, {
      city: lead.city,
      routeType: routingResult.routeType,
      responsibleId: routingResult.responsibleId,
      responsibleWhatsapp: routingResult.responsibleWhatsapp,
      leadId: lead.id,
      leadName: lead.contactName,
    });
    await sendWhatsAppMessageForOrg(input.organizationId, routingResult.responsibleWhatsapp, notificationMessage);
    console.log(`[route:${input.organizationId}] Notification envoyée au responsable`, {
      city: lead.city,
      routeType: routingResult.routeType,
      responsibleId: routingResult.responsibleId,
      responsibleWhatsapp: routingResult.responsibleWhatsapp,
      leadId: lead.id,
    });

    const updatedLead = await prisma.prospectLead.update({
      where: { id: lead.id },
      data: {
        locationId: routingResult.locationId ?? lead.locationId ?? null,
        responsibleId: routingResult.responsibleId ?? lead.responsibleId ?? null,
          status: "ROUTED" as const,
          routeStatus: "SENT" as const,
        isRouted: true,
        routedAt: new Date(),
      },
    });

    if (responsible) {
      await prisma.prospectLead.update({
        where: { id: updatedLead.id },
        data: { responsibleId: responsible.id },
      });
    }

    if (location) {
      await prisma.prospectLead.update({
        where: { id: updatedLead.id },
        data: { locationId: location.id },
      });
    }

    return updatedLead;
  } catch (error) {
    await prisma.prospectLead.update({
      where: { id: lead.id },
      data: {
        locationId: routingResult.locationId ?? lead.locationId ?? null,
        responsibleId: routingResult.responsibleId ?? lead.responsibleId ?? null,
          status: "QUALIFIED" as const,
          routeStatus: "FAILED" as const,
        isRouted: false,
      },
    });
    console.error("[ROUTING] Échec d'envoi au responsable :", error);
    return lead;
  }
}
