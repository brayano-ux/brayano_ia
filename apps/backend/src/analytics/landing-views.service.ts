import { createHmac } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { prisma } from "../database/client.js";

/** Journées à l'heure du Cameroun (UTC+1, sans changement d'heure), comme le reste des statistiques de la plateforme. */
const TIMEZONE_OFFSET_MS = 3_600_000;

function dayKeyFor(date: Date): string {
  return new Date(date.getTime() + TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Empreinte à sens unique du visiteur, pour estimer les visiteurs distincts sans rien conserver d'identifiant :
 * ni l'adresse IP, ni l'en-tête du navigateur ne sont stockés, seule cette empreinte l'est, et elle change chaque
 * jour (le jour fait partie de la clé). On ne peut pas en retrouver l'adresse d'origine.
 */
function hashVisitor(day: string, ip: string, userAgent: string): string {
  const secret = env.MEDIA_SIGNING_SECRET || "landing-views-dev-secret";
  return createHmac("sha256", secret).update(`${day}:${ip}:${userAgent}`).digest("hex");
}

const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|uptime|headless/i;

export function isLikelyBot(userAgent: string): boolean {
  return !userAgent.trim() || BOT_PATTERN.test(userAgent);
}

/** Enregistre une visite de la page d'accueil. Ne lève jamais : un souci de comptage ne doit pas gêner un visiteur. */
export async function recordLandingPageView(ip: string, userAgent: string, at = new Date()): Promise<void> {
  try {
    const day = dayKeyFor(at);
    await prisma.landingPageView.create({ data: { day, visitorHash: hashVisitor(day, ip, userAgent) } });
  } catch (error) {
    console.error("❌ Comptage de visite ignoré :", error instanceof Error ? error.message : error);
  }
}

export interface LandingViewsSummary {
  today: { views: number; uniqueVisitors: number };
  last7Days: { views: number; uniqueVisitors: number };
  last30Days: { views: number; uniqueVisitors: number };
  total: { views: number; uniqueVisitors: number };
  daily: Array<{ date: string; views: number; uniqueVisitors: number }>;
}

/** Jours (AAAA-MM-JJ, heure du Cameroun) des `days` derniers jours, du plus ancien au plus récent. */
function lastDays(days: number, now = Date.now()): string[] {
  const todayLocal = Math.floor((now + TIMEZONE_OFFSET_MS) / 86_400_000) * 86_400_000;
  return Array.from({ length: days }, (_, index) => new Date(todayLocal - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10));
}

export async function getLandingViewsSummary(days = 30): Promise<LandingViewsSummary> {
  const dates = lastDays(Math.max(days, 30));
  const windowDays = lastDays(days);
  const since = dates[0]!;

  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<Array<{ day: string; views: bigint; unique_visitors: bigint }>>(
      Prisma.sql`SELECT day, count(*) AS views, count(DISTINCT visitor_hash) AS unique_visitors
                 FROM landing_page_views WHERE day >= ${since} GROUP BY day`,
    ),
    prisma.$queryRaw<Array<{ views: bigint; unique_visitors: bigint }>>(
      Prisma.sql`SELECT count(*) AS views, count(DISTINCT visitor_hash) AS unique_visitors FROM landing_page_views`,
    ),
  ]);
  const byDay = new Map(rows.map((row) => [row.day, { views: Number(row.views), uniqueVisitors: Number(row.unique_visitors) }]));
  const daily = dates.map((date) => ({ date, ...(byDay.get(date) ?? { views: 0, uniqueVisitors: 0 }) }));
  const sum = (dateList: string[], key: "views" | "uniqueVisitors") => dateList.reduce((total, date) => total + (byDay.get(date)?.[key] ?? 0), 0);

  return {
    today: { views: sum([dates.at(-1)!], "views"), uniqueVisitors: sum([dates.at(-1)!], "uniqueVisitors") },
    last7Days: { views: sum(dates.slice(-7), "views"), uniqueVisitors: sum(dates.slice(-7), "uniqueVisitors") },
    last30Days: { views: sum(dates.slice(-30), "views"), uniqueVisitors: sum(dates.slice(-30), "uniqueVisitors") },
    total: { views: Number(totalRows[0]?.views ?? 0), uniqueVisitors: Number(totalRows[0]?.unique_visitors ?? 0) },
    daily: daily.filter((entry) => windowDays.includes(entry.date)),
  };
}
