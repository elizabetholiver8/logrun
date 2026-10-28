import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { activities, athletes } from "../db/schema";
import {
  StravaApiError,
  stravaFetchWithRateLimit,
  type RateLimit,
} from "./strava";

/**
 * Activity sync against Strava.
 *
 * Two modes share one code path:
 *  - backfill: walk history backwards from the backfill cursor until a page
 *    comes back empty, then mark the backfill complete.
 *  - incremental: fetch anything newer than the newest activity seen so far.
 *    Webhooks (step 6) make this rarely necessary, but it keeps the Sync
 *    button useful and recovers from missed events.
 *
 * Every call is bounded by MAX_PAGES_PER_RUN so it fits a serverless
 * function's wall-clock limit; the response says whether more remains.
 */

export const PER_PAGE = 200;
export const MAX_PAGES_PER_RUN = 5;
/** Stop when fewer than this many 15-minute requests remain. */
export const RATE_LIMIT_HEADROOM = 10;

/** Strava sport types this app treats as runs. */
export const RUN_SPORT_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

/** The subset of Strava's SummaryActivity this app reads. */
export type StravaSummaryActivity = {
  id: number;
  name: string;
  sport_type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain?: number;
  start_date: string;
  start_date_local: string;
  timezone?: string;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  map?: { summary_polyline?: string | null } | null;
  [key: string]: unknown;
};

export type ActivityRow = typeof activities.$inferInsert;

export type SyncResult = {
  mode: "backfill" | "incremental";
  pagesFetched: number;
  /** Activities of any sport type Strava returned. */
  seen: number;
  /** Runs written to the database. */
  upserted: number;
  /** True when history is complete, or the incremental window is drained. */
  done: boolean;
  /** Why the run stopped before finishing, when it did. */
  stoppedBecause?: "max_pages" | "rate_limit";
  rateLimit: RateLimit | null;
};

/** Pure: map a Strava activity to an insert row. Exported for tests. */
export function toActivityRow(a: StravaSummaryActivity, athleteId: number): ActivityRow {
  return {
    id: a.id,
    athleteId,
    name: a.name,
    sportType: a.sport_type,
    distanceM: a.distance,
    movingTimeS: a.moving_time,
    elapsedTimeS: a.elapsed_time,
    totalElevationGainM: a.total_elevation_gain ?? null,
    startDate: new Date(a.start_date),
    // start_date_local is wall-clock time with a Z suffix Strava adds for
    // formatting; strip it so Postgres stores it as a naive timestamp.
    startDateLocal: new Date(a.start_date_local.replace(/Z$/, "")),
    timezone: a.timezone ?? null,
    averageSpeedMps: a.average_speed ?? null,
    maxSpeedMps: a.max_speed ?? null,
    averageHeartrate: a.average_heartrate ?? null,
    maxHeartrate: a.max_heartrate ?? null,
    summaryPolyline: a.map?.summary_polyline ?? null,
    raw: a,
    syncedAt: new Date(),
  };
}

/** Pure: true when the next request would eat into the safety margin. */
export function nearRateLimit(rl: RateLimit | null, headroom = RATE_LIMIT_HEADROOM): boolean {
  if (!rl) return false;
  return rl.shortLimit - rl.shortUsage < headroom || rl.dailyLimit - rl.dailyUsage < headroom;
}

/** Pure: oldest and newest start_date in a page, or null for an empty page. */
export function pageBounds(page: StravaSummaryActivity[]): { oldest: Date; newest: Date } | null {
  if (page.length === 0) return null;
  let oldest = Infinity;
  let newest = -Infinity;
  for (const a of page) {
    const t = Date.parse(a.start_date);
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
  }
  return { oldest: new Date(oldest), newest: new Date(newest) };
}

async function upsertRuns(page: StravaSummaryActivity[], athleteId: number): Promise<number> {
  const rows = page.filter((a) => RUN_SPORT_TYPES.has(a.sport_type)).map((a) => toActivityRow(a, athleteId));
  if (rows.length === 0) return 0;
  await db
    .insert(activities)
    .values(rows)
    .onConflictDoUpdate({
      target: activities.id,
      set: {
        name: sql`excluded.name`,
        sportType: sql`excluded.sport_type`,
        distanceM: sql`excluded.distance_m`,
        movingTimeS: sql`excluded.moving_time_s`,
        elapsedTimeS: sql`excluded.elapsed_time_s`,
        totalElevationGainM: sql`excluded.total_elevation_gain_m`,
        startDate: sql`excluded.start_date`,
        startDateLocal: sql`excluded.start_date_local`,
        timezone: sql`excluded.timezone`,
        averageSpeedMps: sql`excluded.average_speed_mps`,
        maxSpeedMps: sql`excluded.max_speed_mps`,
        averageHeartrate: sql`excluded.average_heartrate`,
        maxHeartrate: sql`excluded.max_heartrate`,
        summaryPolyline: sql`excluded.summary_polyline`,
        raw: sql`excluded.raw`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
  return rows.length;
}

/**
 * Run one bounded sync pass for an athlete. Picks backfill until history is
 * complete, then incremental. Safe to call repeatedly; every write is an
 * upsert keyed on Strava's activity ID.
 */
export async function syncActivities(
  athleteId: number,
  opts: { maxPages?: number } = {},
): Promise<SyncResult> {
  const maxPages = opts.maxPages ?? MAX_PAGES_PER_RUN;
  const athlete = await db.query.athletes.findFirst({ where: eq(athletes.id, athleteId) });
  if (!athlete) throw new Error(`Unknown athlete ${athleteId}`);

  const mode: SyncResult["mode"] = athlete.backfillCompletedAt ? "incremental" : "backfill";
  const result: SyncResult = { mode, pagesFetched: 0, seen: 0, upserted: 0, done: false, rateLimit: null };

  let cursor = athlete.backfillCursor;
  let newest = athlete.newestActivityAt;
  // Incremental mode pages forward with `after`; Strava returns oldest first
  // in that case, so we advance the lower bound after each page.
  let after = mode === "incremental" ? newest : null;

  while (result.pagesFetched < maxPages) {
    const params = new URLSearchParams({ per_page: String(PER_PAGE) });
    if (mode === "backfill" && cursor) params.set("before", String(Math.floor(cursor.getTime() / 1000)));
    if (mode === "incremental" && after) params.set("after", String(Math.floor(after.getTime() / 1000)));

    let page: StravaSummaryActivity[];
    try {
      const res = await stravaFetchWithRateLimit<StravaSummaryActivity[]>(
        athleteId,
        `/athlete/activities?${params.toString()}`,
      );
      page = res.data;
      result.rateLimit = res.rateLimit;
    } catch (err) {
      if (err instanceof StravaApiError && err.status === 429) {
        result.stoppedBecause = "rate_limit";
        break;
      }
      throw err;
    }
    result.pagesFetched += 1;
    result.seen += page.length;

    const bounds = pageBounds(page);
    if (!bounds) {
      result.done = true;
      if (mode === "backfill") {
        await db.update(athletes).set({ backfillCompletedAt: new Date() }).where(eq(athletes.id, athleteId));
      }
      break;
    }

    result.upserted += await upsertRuns(page, athleteId);

    if (!newest || bounds.newest > newest) newest = bounds.newest;
    if (mode === "backfill") {
      // Subtract a second so an activity starting exactly at the cursor is not refetched forever.
      cursor = new Date(bounds.oldest.getTime() - 1000);
      await db
        .update(athletes)
        .set({ backfillCursor: cursor, newestActivityAt: newest })
        .where(eq(athletes.id, athleteId));
    } else {
      after = new Date(bounds.newest.getTime() + 1000);
      await db.update(athletes).set({ newestActivityAt: newest }).where(eq(athletes.id, athleteId));
    }

    // A short page means Strava has nothing more in this direction.
    if (page.length < PER_PAGE) {
      result.done = true;
      if (mode === "backfill") {
        await db.update(athletes).set({ backfillCompletedAt: new Date() }).where(eq(athletes.id, athleteId));
      }
      break;
    }

    if (nearRateLimit(result.rateLimit)) {
      result.stoppedBecause = "rate_limit";
      break;
    }
  }

  if (!result.done && !result.stoppedBecause) result.stoppedBecause = "max_pages";
  return result;
}
