import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../database/client.js";

/** Les journées de la plateforme se comptent à l'heure du Cameroun (UTC+1, sans changement d'heure). */
export const PLATFORM_TIMEZONE = "Africa/Douala";
const OFFSET_MS = 3_600_000;

export interface AiResponseUsage {
  today: number;
  last7Days: number;
  last30Days: number;
  total: number;
  lastAt: string | null;
}

export const EMPTY_USAGE: AiResponseUsage = { today: 0, last7Days: 0, last30Days: 0, total: 0, lastAt: null };

/**
 * Réponses générées par l'IA (messages sortants écrits par l'IA : réponses, accueil, relances) pour chaque entreprise.
 * Même définition que « Réponses de l'agent » dans le tableau de bord du client.
 */
export async function getAiResponseUsageByOrganization(): Promise<Map<string, AiResponseUsage>> {
  const rows = await prisma.$queryRaw<Array<{ organization_id: string; today: number; last7: number; last30: number; total: number; last_at: Date | null }>>(Prisma.sql`
    WITH bounds AS (
      SELECT (date_trunc('day', now() AT TIME ZONE ${PLATFORM_TIMEZONE}) AT TIME ZONE ${PLATFORM_TIMEZONE}) AS today_start
    ), ai AS (
      SELECT c.organization_id, (m.created_at AT TIME ZONE 'UTC') AS ts
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.direction::text = 'OUTBOUND' AND m.author::text = 'AI'
    )
    SELECT ai.organization_id,
           (count(*) FILTER (WHERE ai.ts >= b.today_start))::int AS today,
           (count(*) FILTER (WHERE ai.ts >= b.today_start - interval '6 days'))::int AS last7,
           (count(*) FILTER (WHERE ai.ts >= b.today_start - interval '29 days'))::int AS last30,
           count(*)::int AS total,
           max(ai.ts) AS last_at
    FROM ai CROSS JOIN bounds b
    GROUP BY ai.organization_id`);
  return new Map(rows.map((row) => [row.organization_id, {
    today: row.today,
    last7Days: row.last7,
    last30Days: row.last30,
    total: row.total,
    lastAt: row.last_at ? row.last_at.toISOString() : null,
  }]));
}

export function sumUsage(usages: Iterable<AiResponseUsage>): Omit<AiResponseUsage, "lastAt"> {
  const totals = { today: 0, last7Days: 0, last30Days: 0, total: 0 };
  for (const usage of usages) {
    totals.today += usage.today;
    totals.last7Days += usage.last7Days;
    totals.last30Days += usage.last30Days;
    totals.total += usage.total;
  }
  return totals;
}

/** Dates (AAAA-MM-JJ, heure du Cameroun) des `days` derniers jours, du plus ancien au plus récent. */
export function lastDays(days: number, now = Date.now()): string[] {
  const todayLocal = Math.floor((now + OFFSET_MS) / 86_400_000) * 86_400_000;
  return Array.from({ length: days }, (_, index) => new Date(todayLocal - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10));
}

/** Réponses de l'IA jour par jour pour une entreprise (les jours sans réponse valent 0). */
export async function getDailyAiResponses(organizationId: string, days: number): Promise<Array<{ date: string; count: number }>> {
  const dates = lastDays(days);
  const rows = await prisma.$queryRaw<Array<{ day: string; count: number }>>(Prisma.sql`
    SELECT to_char((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${PLATFORM_TIMEZONE}, 'YYYY-MM-DD') AS day, count(*)::int AS count
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.organization_id = ${organizationId} AND m.direction::text = 'OUTBOUND' AND m.author::text = 'AI'
      AND (m.created_at AT TIME ZONE 'UTC') >= ((${dates[0]!}::date)::timestamp AT TIME ZONE ${PLATFORM_TIMEZONE})
    GROUP BY 1`);
  const byDay = new Map(rows.map((row) => [row.day, row.count]));
  return dates.map((date) => ({ date, count: byDay.get(date) ?? 0 }));
}
