/**
 * Pure formatting and bucketing helpers for the dashboard. No I/O, fully
 * unit tested. Strava stores meters and seconds; these convert for display.
 */

export type Units = "miles" | "km";

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_KM = 1000;

/** Strava's measurement_preference is "feet" or "meters". */
export function unitsFromPreference(pref: string | null | undefined): Units {
  return pref === "meters" ? "km" : "miles";
}

export function metersToDistance(m: number, units: Units): number {
  return m / (units === "miles" ? METERS_PER_MILE : METERS_PER_KM);
}

/** "5.02" style, one or two decimals depending on size. */
export function formatDistance(m: number, units: Units): string {
  const d = metersToDistance(m, units);
  return d >= 100 ? d.toFixed(0) : d.toFixed(d >= 10 ? 1 : 2);
}

export function unitLabel(units: Units): string {
  return units === "miles" ? "mi" : "km";
}

/** "1:02:35" for an hour or more, "42:07" below. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Seconds per unit distance; null when distance is zero. */
export function paceSecondsPer(distanceM: number, movingTimeS: number, units: Units): number | null {
  const d = metersToDistance(distanceM, units);
  if (d <= 0) return null;
  return movingTimeS / d;
}

/** "8:42" for 522 seconds. */
export function formatPace(secondsPerUnit: number | null): string {
  if (secondsPerUnit === null || !Number.isFinite(secondsPerUnit)) return "–";
  const s = Math.round(secondsPerUnit);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Hours with one decimal, "12.5". */
export function formatHours(totalSeconds: number): string {
  return (totalSeconds / 3600).toFixed(1);
}

/**
 * Monday-based week start for a wall-clock date. Takes the activity's
 * start_date_local, which is stored as a naive timestamp, so no timezone
 * math happens here: a run at 11pm Sunday local time belongs to Sunday's
 * week whatever UTC says.
 */
export function weekStart(local: Date): Date {
  const d = new Date(local.getFullYear(), local.getMonth(), local.getDate());
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return d;
}

/** "YYYY-MM-DD" from a local date, no timezone shift. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type WeekBucket = {
  /** Week start as YYYY-MM-DD. */
  week: string;
  runs: number;
  distanceM: number;
  movingTimeS: number;
};

/**
 * Group runs into Monday-based weeks and fill empty weeks with zeros so
 * charts show gaps as gaps. `weeks` is how many to return, ending with the
 * week containing `today`.
 */
export function bucketByWeek(
  runs: Array<{ startDateLocal: Date; distanceM: number; movingTimeS: number }>,
  weeks: number,
  today: Date,
): WeekBucket[] {
  const end = weekStart(today);
  const first = new Date(end);
  first.setDate(first.getDate() - 7 * (weeks - 1));

  const byKey = new Map<string, WeekBucket>();
  for (let i = 0; i < weeks; i++) {
    const w = new Date(first);
    w.setDate(w.getDate() + 7 * i);
    const key = localDateKey(w);
    byKey.set(key, { week: key, runs: 0, distanceM: 0, movingTimeS: 0 });
  }
  for (const r of runs) {
    const key = localDateKey(weekStart(r.startDateLocal));
    const b = byKey.get(key);
    if (!b) continue; // outside the window
    b.runs += 1;
    b.distanceM += r.distanceM;
    b.movingTimeS += r.movingTimeS;
  }
  return [...byKey.values()];
}
