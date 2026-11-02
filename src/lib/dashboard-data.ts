import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { activities, athletes } from "../db/schema";
import { bucketByWeek, type WeekBucket } from "./units";

export const CHART_WEEKS = 26;
export const RECENT_RUNS = 20;

export type Totals = { runs: number; distanceM: number; movingTimeS: number };

export type RecentRun = {
  id: number;
  name: string;
  startDateLocal: Date;
  distanceM: number;
  movingTimeS: number;
  totalElevationGainM: number | null;
  hasGps: boolean;
};

export type DashboardData = {
  athlete: typeof athletes.$inferSelect;
  last30: Totals;
  thisWeek: Totals;
  weekly: WeekBucket[];
  recent: RecentRun[];
};

function emptyTotals(): Totals {
  return { runs: 0, distanceM: 0, movingTimeS: 0 };
}

/**
 * Everything the dashboard needs in three queries: the athlete row, one
 * aggregate over the last 30 days, and one slice of per-run rows for the
 * chart window from which weekly buckets and this week's totals are
 * derived. Bucketing in JS keeps the week boundary logic in one tested
 * place rather than duplicating it in SQL.
 */
export async function loadDashboard(athleteId: number, now = new Date()): Promise<DashboardData | null> {
  const athlete = await db.query.athletes.findFirst({ where: eq(athletes.id, athleteId) });
  if (!athlete) return null;

  const since30 = new Date(now.getTime() - 30 * 86400_000);
  const sinceChart = new Date(now.getTime() - (CHART_WEEKS + 1) * 7 * 86400_000);

  const [[agg], windowRuns, recent] = await Promise.all([
    db
      .select({
        runs: sql<number>`count(*)::int`,
        distanceM: sql<number>`coalesce(sum(${activities.distanceM}), 0)::float`,
        movingTimeS: sql<number>`coalesce(sum(${activities.movingTimeS}), 0)::int`,
      })
      .from(activities)
      .where(and(eq(activities.athleteId, athleteId), gte(activities.startDate, since30))),
    db
      .select({
        startDateLocal: activities.startDateLocal,
        distanceM: activities.distanceM,
        movingTimeS: activities.movingTimeS,
      })
      .from(activities)
      .where(and(eq(activities.athleteId, athleteId), gte(activities.startDate, sinceChart))),
    db
      .select({
        id: activities.id,
        name: activities.name,
        startDateLocal: activities.startDateLocal,
        distanceM: activities.distanceM,
        movingTimeS: activities.movingTimeS,
        totalElevationGainM: activities.totalElevationGainM,
        hasGps: sql<boolean>`${activities.summaryPolyline} is not null`,
      })
      .from(activities)
      .where(eq(activities.athleteId, athleteId))
      .orderBy(desc(activities.startDate))
      .limit(RECENT_RUNS),
  ]);

  const weekly = bucketByWeek(windowRuns, CHART_WEEKS, now);
  const current = weekly[weekly.length - 1];
  const thisWeek: Totals = current
    ? { runs: current.runs, distanceM: current.distanceM, movingTimeS: current.movingTimeS }
    : emptyTotals();

  return {
    athlete,
    last30: agg ?? emptyTotals(),
    thisWeek,
    weekly,
    recent,
  };
}

export async function loadRun(athleteId: number, runId: number) {
  return db.query.activities.findFirst({
    where: and(eq(activities.id, runId), eq(activities.athleteId, athleteId)),
  });
}
