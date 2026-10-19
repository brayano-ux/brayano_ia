import { prisma } from "../database/client.js";
import { getOpeningStatus } from "../ai/business-hours.js";
import { addDays, formatLocalDate, type WorkingHours } from "../appointments/availability.js";

export type StatsPeriodDays = 1 | 7 | 30;

/** On estime qu'une réponse écrite à la main prend environ une minute : valeur affichée comme estimation, jamais comme mesure. */
export const ESTIMATED_MINUTES_PER_ANSWER = 1;

export interface DashboardStats {
  days: StatsPeriodDays;
  /** Premier jour inclus (date locale AAAA-MM-JJ) et fuseau utilisé pour découper les jours. */
  from: string;
  timezone: string;
  conversations: { started: number; total: number };
  messages: { fromClients: number; byAssistant: number; byTeam: number; assistantShare: number | null };
  handoffs: number;
  orders: { count: number; revenue: number; paidRevenue: number; unpaid: number };
  appointments: number;
  afterHours: { enabled: boolean; clientMessages: number };
  estimatedMinutesSaved: number;
  stages: Record<"NEW" | "INTERESTED" | "ORDERED" | "CALLBACK", number>;
  series: Array<{ day: string; clientMessages: number; assistantMessages: number; orders: number }>;
}

/** Début du premier jour local de la période, converti en date UTC. */
function periodStartUtc(now: Date, days: number, timezone: string): { start: Date; fromDay: string } {
  const today = formatLocalDate(now, timezone);
  const fromDay = addDays(today, -(days - 1));
  // Minuit local = minuit UTC décalé du fuseau : on cherche l'instant dont la date locale change.
  const approx = new Date(`${fromDay}T00:00:00Z`);
  for (const offsetHours of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8, -9, 9, -10, 10, -11, 11, -12, 12, -13, 13, -14, 14]) {
    const candidate = new Date(approx.getTime() + offsetHours * 3600_000);
    if (formatLocalDate(candidate, timezone) === fromDay && formatLocalDate(new Date(candidate.getTime() - 1), timezone) !== fromDay) {
      return { start: candidate, fromDay };
    }
  }
  return { start: approx, fromDay };
}

export async function getDashboardStats(organizationId: string, days: StatsPeriodDays, now = new Date()): Promise<DashboardStats> {
  const settings = await prisma.aiSettings.findUnique({ where: { organizationId } });
  const timezone = settings?.businessTimezone || "Africa/Douala";
  const { start, fromDay } = periodStartUtc(now, days, timezone);
  const inPeriod = { gte: start, lte: now };
  const messageScope = { conversation: { organizationId }, createdAt: inPeriod };

  const [
    startedConversations,
    totalConversations,
    fromClients,
    byAssistant,
    byTeam,
    handoffs,
    orders,
    appointments,
    stageGroups,
    clientMessageDates,
    messageSeries,
    orderSeries,
  ] = await Promise.all([
    prisma.conversation.count({ where: { organizationId, createdAt: inPeriod } }),
    prisma.conversation.count({ where: { organizationId } }),
    prisma.message.count({ where: { ...messageScope, direction: "INBOUND" } }),
    prisma.message.count({ where: { ...messageScope, direction: "OUTBOUND", author: "AI" } }),
    prisma.message.count({ where: { ...messageScope, direction: "OUTBOUND", author: "HUMAN" } }),
    prisma.message.count({ where: { ...messageScope, direction: "OUTBOUND", author: "AI", aiMeta: { path: ["needsHuman"], equals: true } } }),
    prisma.order.findMany({
      where: { organizationId, createdAt: inPeriod, status: { not: "CANCELLED" } },
      select: { total: true, paymentStatus: true },
    }),
    prisma.appointment.count({ where: { organizationId, createdAt: inPeriod, status: { not: "CANCELLED" } } }),
    prisma.conversation.groupBy({ by: ["stage"], where: { organizationId }, _count: { _all: true } }),
    settings?.businessHoursEnabled
      ? prisma.message.findMany({ where: { ...messageScope, direction: "INBOUND" }, select: { createdAt: true }, take: 20000 })
      : Promise.resolve([] as Array<{ createdAt: Date }>),
    prisma.$queryRaw<Array<{ day: string; direction: string; author: string; count: bigint }>>`
      SELECT to_char((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
             m.direction::text AS direction, m.author::text AS author, count(*) AS count
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id = ${organizationId} AND m.created_at >= ${start} AND m.created_at <= ${now}
      GROUP BY 1, 2, 3`,
    prisma.$queryRaw<Array<{ day: string; count: bigint }>>`
      SELECT to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day, count(*) AS count
      FROM orders
      WHERE organization_id = ${organizationId} AND created_at >= ${start} AND created_at <= ${now} AND status <> 'CANCELLED'
      GROUP BY 1`,
  ]);

  const stages = { NEW: 0, INTERESTED: 0, ORDERED: 0, CALLBACK: 0 };
  for (const group of stageGroups) stages[group.stage] = group._count._all;

  let afterHoursMessages = 0;
  if (settings?.businessHoursEnabled) {
    const config = { enabled: true, timezone, hours: (settings.businessHours && typeof settings.businessHours === "object" ? settings.businessHours : {}) as WorkingHours };
    afterHoursMessages = clientMessageDates.filter((message) => !getOpeningStatus(config, message.createdAt).open).length;
  }

  const seriesMap = new Map<string, { day: string; clientMessages: number; assistantMessages: number; orders: number }>();
  for (let offset = 0; offset < days; offset += 1) {
    const day = addDays(fromDay, offset);
    seriesMap.set(day, { day, clientMessages: 0, assistantMessages: 0, orders: 0 });
  }
  for (const row of messageSeries) {
    const entry = seriesMap.get(row.day);
    if (!entry) continue;
    if (row.direction === "INBOUND") entry.clientMessages += Number(row.count);
    else if (row.author === "AI") entry.assistantMessages += Number(row.count);
  }
  for (const row of orderSeries) {
    const entry = seriesMap.get(row.day);
    if (entry) entry.orders += Number(row.count);
  }

  const answered = byAssistant + byTeam;
  return {
    days,
    from: fromDay,
    timezone,
    conversations: { started: startedConversations, total: totalConversations },
    messages: { fromClients, byAssistant, byTeam, assistantShare: answered ? Math.round((byAssistant / answered) * 100) : null },
    handoffs,
    orders: {
      count: orders.length,
      revenue: orders.reduce((sum, order) => sum + (order.total ?? 0), 0),
      paidRevenue: orders.filter((order) => order.paymentStatus === "PAID").reduce((sum, order) => sum + (order.total ?? 0), 0),
      unpaid: orders.filter((order) => order.paymentStatus === "UNPAID").length,
    },
    appointments,
    afterHours: { enabled: Boolean(settings?.businessHoursEnabled), clientMessages: afterHoursMessages },
    estimatedMinutesSaved: byAssistant * ESTIMATED_MINUTES_PER_ANSWER,
    stages,
    series: [...seriesMap.values()],
  };
}
