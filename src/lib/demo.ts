/**
 * Demo mode: a fixed athlete whose history is seeded from an anonymized
 * export rather than synced from Strava. Anyone can open it from the welcome
 * page with no account. The session carries a `demo` flag and every write
 * path refuses when it is set, so the seeded data cannot be changed from the
 * browser.
 */

/** Strava athlete IDs are large; 1 cannot collide with a real connection. */
export const DEMO_ATHLETE_ID = 1;
export const DEMO_FIRST_NAME = "Demo";
export const DEMO_LAST_NAME = "Runner";

/** Demo sessions are short; a recruiter's tab should not stay signed in for a month. */
export const DEMO_SESSION_TTL_SECONDS = 60 * 60 * 24;


/** One exported run from scripts/demo-export.ts, keys shortened to keep the file small. */
export type ExportedRun = {
  /** distance, meters */
  d: number;
  /** moving time, seconds */
  t: number;
  /** elapsed time, seconds */
  e: number;
  /** elevation gain, meters */
  g: number;
  /** start, ISO UTC */
  s: string;
  /** summary polyline, may be empty */
  p: string;
  /** average heart rate, may be null */
  h: number | null;
};

export type SeedRun = {
  id: number;
  name: string;
  sportType: "Run";
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  totalElevationGainM: number;
  startDate: Date;
  startDateLocal: Date;
  timezone: string;
  averageSpeedMps: number;
  averageHeartrate: number | null;
  summaryPolyline: string | null;
};

const DAY_MS = 86_400_000;

/**
 * Turn the export into rows for the demo athlete.
 *  - Dates shift forward by whole days so the newest run lands on `today`
 *    and every time of day is preserved. The demo always looks current.
 *  - Names are generic, by time of day, so nothing from the source account
 *    leaks through titles.
 *  - Only the `keepPolylines` most recent GPS tracks are kept. Each track
 *    shows where a run started, so fewer is more private.
 *  - IDs are 1..n in date order; real Strava activity IDs are ten digits,
 *    so these cannot collide with a synced run.
 */
export function transformExport(
  rows: ExportedRun[],
  today: Date,
  opts: { keepPolylines: number; timeZone: string },
): SeedRun[] {
  const sorted = [...rows]
    .filter((r) => r.d > 0 && r.t > 0)
    .sort((a, b) => a.s.localeCompare(b.s));
  if (sorted.length === 0) return [];

  // Compare calendar days in the target zone, so seeding late in the evening
  // does not push the newest run onto tomorrow's date.
  const newest = new Date(sorted[sorted.length - 1].s);
  const shiftDays = Math.round(
    (startOfDay(toLocalWallClock(today, opts.timeZone)).getTime() - startOfDay(toLocalWallClock(newest, opts.timeZone)).getTime()) / DAY_MS,
  );
  const shiftMs = shiftDays * DAY_MS;

  const withGps = sorted.filter((r) => r.p).slice(-opts.keepPolylines);
  const keep = new Set(withGps);

  return sorted.map((r, i) => {
    const startDate = new Date(new Date(r.s).getTime() + shiftMs);
    const startDateLocal = toLocalWallClock(startDate, opts.timeZone);
    return {
      id: i + 1,
      name: runName(startDateLocal.getHours(), r.d),
      sportType: "Run",
      distanceM: r.d,
      movingTimeS: r.t,
      elapsedTimeS: Math.max(r.e, r.t),
      totalElevationGainM: r.g,
      startDate,
      startDateLocal,
      timezone: opts.timeZone,
      averageSpeedMps: r.d / r.t,
      averageHeartrate: r.h,
      summaryPolyline: keep.has(r) ? r.p : null,
    };
  });
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Strava stores start_date_local as the wall clock time in the activity's
 * zone with no offset. Our column is `timestamp` without time zone, read
 * back as if it were local, so build a Date whose local fields equal the
 * wall clock in `timeZone`.
 */
export function toLocalWallClock(utc: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

export function runName(hour: number, distanceM: number): string {
  if (distanceM >= 24_000) return "Long Run";
  if (hour < 11) return "Morning Run";
  if (hour < 14) return "Lunch Run";
  if (hour < 18) return "Afternoon Run";
  return "Evening Run";
}
