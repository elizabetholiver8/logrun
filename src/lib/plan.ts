import type { WorkoutKind } from "../db/schema";
import { localDateKey, weekStart } from "./units";

/**
 * Training plan generator. Pure: no I/O, no clock. Everything here is
 * deterministic for a given input so it can be unit tested exhaustively.
 *
 * Principles encoded, each with a constant below so the tests can reference
 * the same numbers:
 *  - weekly volume ramps at most RAMP_MAX per week from the athlete's
 *    baseline toward a peak that depends on the goal distance
 *  - every CUTBACK_EVERY-th week is a cutback at CUTBACK_FACTOR
 *  - the last TAPER_WEEKS before the race taper toward TAPER_FLOOR
 *  - one long run per week at LONG_RUN_SHARE of weekly volume, capped so it
 *    never exceeds the goal distance for short goals
 *  - one quality session per week, alternating tempo and intervals, kept
 *    off the days next to the long run unless the athlete overrides it
 *  - run days are the athlete's own picks, or spread evenly when not given
 *  - lifting goes on the requested weekdays, never the day before the long
 *    run; a conflicting pick is moved and reported
 */

export type GoalDistance = "5k" | "10k" | "half" | "marathon";

export const GOAL_DISTANCE_M: Record<GoalDistance, number> = {
  "5k": 5000,
  "10k": 10000,
  half: 21097.5,
  marathon: 42195,
};

/** Peak weekly volume as a multiple of goal distance, and a floor in meters. */
const PEAK_BY_GOAL: Record<GoalDistance, { multiple: number; floorM: number }> = {
  "5k": { multiple: 5, floorM: 25_000 },
  "10k": { multiple: 4, floorM: 32_000 },
  half: { multiple: 2.6, floorM: 45_000 },
  marathon: { multiple: 1.8, floorM: 64_000 },
};

export const RAMP_MAX = 0.1;
export const CUTBACK_EVERY = 4;
export const CUTBACK_FACTOR = 0.75;
export const LONG_RUN_SHARE = 0.32;
export const TAPER_FLOOR = 0.55;
export const MATCH_TOLERANCE = 0.2;
export const BASELINE_WEEKS = 4;

export function taperWeeks(goal: GoalDistance): number {
  return goal === "half" || goal === "marathon" ? 2 : 1;
}

/** 0 = Sunday … 6 = Saturday, matching Date.getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type PlanInput = {
  goal: GoalDistance;
  /** Local calendar date of the race, YYYY-MM-DD. */
  raceDate: string;
  /** Local calendar date the plan starts, normally today. */
  startDate: string;
  /** How many days to run when `runDays` is not given; the generator spreads them. */
  daysPerWeek: 3 | 4 | 5 | 6;
  /** Exact weekdays to run. Must include the long run day. Overrides daysPerWeek. */
  runDays?: Weekday[];
  liftDays: Weekday[];
  /** Weekday for the long run. Defaults to Sunday. */
  longRunDay?: Weekday;
  /**
   * Weekday for the quality session. Defaults to the first run day that is
   * not the long run or the day before it. A pick next to the long run is
   * honored but reported as a warning.
   */
  qualityDay?: Weekday;
  baseline: Baseline;
};

export type Baseline = {
  /** Average meters per week over the baseline window. */
  weeklyM: number;
  /** Longest single run in the window, meters. */
  longestM: number;
  /** How many full weeks the average came from. */
  weeksOfData: number;
};

export type PlannedWorkout = {
  date: string;
  kind: WorkoutKind;
  targetDistanceM: number | null;
  notes: string | null;
};

export type PlanWeek = {
  week: string;
  phase: "build" | "cutback" | "taper" | "race";
  targetM: number;
  workouts: PlannedWorkout[];
};

export type GeneratedPlan = {
  weeks: PlanWeek[];
  peakM: number;
  warnings: string[];
};

type RunLike = { startDateLocal: Date; distanceM: number };

/**
 * Baseline from synced runs: average weekly volume and longest run over the
 * last BASELINE_WEEKS complete weeks before `today`. The current partial
 * week is excluded so a Monday morning does not read as a zero week.
 */
export function computeBaseline(runs: RunLike[], today: Date): Baseline {
  const currentWeek = weekStart(today);
  const windowStart = new Date(currentWeek);
  windowStart.setDate(windowStart.getDate() - 7 * BASELINE_WEEKS);

  const byWeek = new Map<string, number>();
  let longestM = 0;
  for (const r of runs) {
    const ws = weekStart(r.startDateLocal);
    if (ws < windowStart || ws >= currentWeek) continue;
    const key = localDateKey(ws);
    byWeek.set(key, (byWeek.get(key) ?? 0) + r.distanceM);
    if (r.distanceM > longestM) longestM = r.distanceM;
  }
  const weeksWithData = byWeek.size;
  if (weeksWithData === 0) return { weeklyM: 0, longestM: 0, weeksOfData: 0 };
  // Average over the full window, so a missed week pulls the baseline down
  // rather than being ignored; that is the honest starting point.
  const total = [...byWeek.values()].reduce((a, b) => a + b, 0);
  return { weeklyM: total / BASELINE_WEEKS, longestM, weeksOfData: weeksWithData };
}

export function peakVolumeM(goal: GoalDistance): number {
  const p = PEAK_BY_GOAL[goal];
  return Math.max(p.floorM, GOAL_DISTANCE_M[goal] * p.multiple);
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Rounded to the nearest 100 m so plans read as tidy numbers. */
function round100(m: number): number {
  return Math.round(m / 100) * 100;
}

/**
 * Weekly volume targets from start to race week. Pure sequence logic,
 * exported so the ramp, cutback and taper rules can be tested without a
 * calendar.
 */
export function weeklyTargets(
  baselineM: number,
  peakM: number,
  totalWeeks: number,
  goal: GoalDistance,
): { targetM: number; phase: PlanWeek["phase"] }[] {
  const taper = taperWeeks(goal);
  const out: { targetM: number; phase: PlanWeek["phase"] }[] = [];
  // Never start below a sensible floor; a brand new runner still needs a plan.
  let current = Math.min(peakM, Math.max(baselineM, peakM * 0.35));
  const buildWeeks = totalWeeks - taper - 1; // last week is race week

  for (let i = 0; i < totalWeeks; i++) {
    const weeksFromEnd = totalWeeks - 1 - i;
    if (weeksFromEnd === 0) {
      out.push({ targetM: round100(peakM * 0.4), phase: "race" });
    } else if (weeksFromEnd <= taper) {
      // Linear taper from the last build volume down to the floor.
      const t = (taper - weeksFromEnd + 1) / (taper + 1);
      const target = current * (1 - t * (1 - TAPER_FLOOR));
      out.push({ targetM: round100(target), phase: "taper" });
    } else {
      const isCutback = buildWeeks >= CUTBACK_EVERY && (i + 1) % CUTBACK_EVERY === 0 && i < buildWeeks - 1;
      if (isCutback) {
        out.push({ targetM: round100(current * CUTBACK_FACTOR), phase: "cutback" });
      } else {
        if (i > 0) current = Math.min(peakM, current * (1 + RAMP_MAX));
        out.push({ targetM: round100(current), phase: "build" });
      }
    }
  }
  return out;
}

/**
 * Lay a week's volume onto weekdays. Returns one workout per day of the
 * week, rest days included, Monday first.
 */
export function layoutWeek(
  weekStartDate: Date,
  targetM: number,
  phase: PlanWeek["phase"],
  opts: {
    daysPerWeek: number;
    longRunDay: Weekday;
    runDays?: Weekday[];
    qualityDay?: Weekday;
    liftDays: Weekday[];
    qualityKind: "tempo" | "intervals";
    goalM: number;
    raceDate?: string;
  },
): PlannedWorkout[] {
  const days: PlannedWorkout[] = [];
  const longM = Math.min(round100(targetM * LONG_RUN_SHARE), Math.max(opts.goalM, round100(targetM * LONG_RUN_SHARE * 0.8)));
  const runDays = opts.runDays ?? chooseRunDays(opts.daysPerWeek, opts.longRunDay);
  const qualityDay = opts.qualityDay ?? defaultQualityDay(runDays, opts.longRunDay);
  const easyDays = runDays.filter((d) => d !== opts.longRunDay && d !== qualityDay);
  const qualityM = round100(targetM * 0.2);
  const easyEach = easyDays.length > 0 ? round100(Math.max(0, targetM - longM - qualityM) / easyDays.length) : 0;

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStartDate, i);
    const dow = date.getDay() as Weekday;
    const key = localDateKey(date);
    let w: PlannedWorkout;
    if (phase === "race" && opts.raceDate === key) {
      w = { date: key, kind: "long", targetDistanceM: opts.goalM, notes: "Race day" };
    } else if (phase === "race" && opts.raceDate && key > opts.raceDate) {
      w = { date: key, kind: "rest", targetDistanceM: null, notes: null };
    } else if (dow === opts.longRunDay && runDays.includes(dow)) {
      w = { date: key, kind: "long", targetDistanceM: longM, notes: phase === "race" ? "Short shakeout, easy" : "Easy effort" };
      if (phase === "race") w.targetDistanceM = round100(Math.min(longM, 6000));
    } else if (dow === qualityDay) {
      w = {
        date: key,
        kind: phase === "taper" || phase === "race" ? "easy" : opts.qualityKind,
        targetDistanceM: qualityM,
        notes:
          phase === "taper" || phase === "race"
            ? "Easy, with a few short strides"
            : opts.qualityKind === "tempo"
              ? "Warm up, then sustained comfortably hard effort, cool down"
              : "Warm up, then short hard repeats with jog recoveries, cool down",
      };
    } else if (easyDays.includes(dow)) {
      w = { date: key, kind: "easy", targetDistanceM: easyEach, notes: null };
    } else {
      w = { date: key, kind: "rest", targetDistanceM: null, notes: null };
    }
    if (opts.liftDays.includes(dow) && w.kind !== "long" && phase !== "race") {
      w.notes = w.notes ? `${w.notes}. Lift` : "Lift";
      if (w.kind === "rest") w.kind = "lift";
    }
    days.push(w);
  }
  return days;
}

/**
 * The quality session goes on the first run day that is neither the long
 * run nor the day before it, so the two hard efforts are separated.
 */
export function defaultQualityDay(runDays: Weekday[], longRunDay: Weekday): Weekday {
  const dayBefore = (longRunDay + 6) % 7;
  const dayAfter = (longRunDay + 1) % 7;
  return (
    runDays.find((d) => d !== longRunDay && d !== dayBefore && d !== dayAfter) ??
    runDays.find((d) => d !== longRunDay && d !== dayBefore) ??
    runDays.find((d) => d !== longRunDay) ??
    runDays[0]
  );
}

/** True when two weekdays are consecutive, wrapping around the week. */
export function adjacentWeekdays(a: Weekday, b: Weekday): boolean {
  const diff = Math.abs(a - b);
  return diff === 1 || diff === 6;
}

/** Spread run days across the week, long run day always included. */
export function chooseRunDays(daysPerWeek: number, longRunDay: Weekday): Weekday[] {
  // Preference order relative to the long run day: the long run itself, then
  // alternate days so hard efforts are separated, then fill in.
  const order = [0, 2, 4, 5, 3, 6, 1].map((offset) => ((longRunDay + offset) % 7) as Weekday);
  return order.slice(0, Math.max(1, Math.min(7, daysPerWeek))).sort((a, b) => a - b);
}

/**
 * Move lift days off the day before the long run. Returns the adjusted list
 * and a warning when something moved.
 */
export function resolveLiftDays(
  liftDays: Weekday[],
  longRunDay: Weekday,
  avoid: Weekday[] = [],
): { liftDays: Weekday[]; warning: string | null } {
  const dayBefore = ((longRunDay + 6) % 7) as Weekday;
  if (!liftDays.includes(dayBefore)) return { liftDays: [...new Set(liftDays)].sort(), warning: null };
  const candidates: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
  const taken = new Set<Weekday>(liftDays);
  const blocked = new Set<Weekday>([dayBefore, longRunDay, ...avoid]);
  // Prefer a day that is neither hard nor adjacent to the long run; fall
  // back to any free day rather than dropping the lift.
  const replacement =
    candidates.find((d) => !blocked.has(d) && !taken.has(d)) ??
    candidates.find((d) => d !== dayBefore && d !== longRunDay && !taken.has(d));
  const moved = liftDays.filter((d) => d !== dayBefore);
  if (replacement !== undefined) moved.push(replacement);
  return {
    liftDays: [...new Set(moved)].sort(),
    warning: `Lifting was moved off ${WEEKDAY_NAMES[dayBefore]} so your legs are fresh for the ${WEEKDAY_NAMES[longRunDay]} long run.`,
  };
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function generatePlan(input: PlanInput): GeneratedPlan {
  const warnings: string[] = [];
  const start = parseLocalDate(input.startDate);
  const race = parseLocalDate(input.raceDate);
  if (race <= start) throw new Error("Race date must be after the start date");

  const longRunDay = input.longRunDay ?? 0;
  const runDays = input.runDays
    ? [...new Set(input.runDays)].sort((a, b) => a - b)
    : chooseRunDays(input.daysPerWeek, longRunDay);
  if (!runDays.includes(longRunDay)) throw new Error("Run days must include the long run day");
  const qualityDay = input.qualityDay ?? defaultQualityDay(runDays, longRunDay);
  if (!runDays.includes(qualityDay) || qualityDay === longRunDay) {
    throw new Error("Quality day must be a run day other than the long run day");
  }
  if (input.qualityDay !== undefined && adjacentWeekdays(qualityDay, longRunDay)) {
    warnings.push(
      `${WEEKDAY_NAMES[qualityDay]} quality sessions sit next to the ${WEEKDAY_NAMES[longRunDay]} long run, so there is no easy day between your two hardest efforts.`,
    );
  }
  const lifts = resolveLiftDays(input.liftDays, longRunDay, [qualityDay]);
  if (lifts.warning) warnings.push(lifts.warning);

  const firstWeek = weekStart(start);
  const raceWeek = weekStart(race);
  const totalWeeks = Math.round((raceWeek.getTime() - firstWeek.getTime()) / (7 * 86400_000)) + 1;

  const goalM = GOAL_DISTANCE_M[input.goal];
  const peakM = peakVolumeM(input.goal);
  const minWeeks = taperWeeks(input.goal) + 3;
  if (totalWeeks < minWeeks) {
    warnings.push(`Only ${totalWeeks} week${totalWeeks === 1 ? "" : "s"} until race day. A ${input.goal} build normally needs at least ${minWeeks}; this plan is compressed.`);
  }
  if (input.baseline.weeksOfData < BASELINE_WEEKS) {
    warnings.push(
      input.baseline.weeksOfData === 0
        ? "No synced runs in the last four weeks, so the plan starts from a conservative default volume."
        : `Baseline uses ${input.baseline.weeksOfData} of the last ${BASELINE_WEEKS} weeks; sync more history for a better starting point.`,
    );
  }

  const targets = weeklyTargets(input.baseline.weeklyM, peakM, totalWeeks, input.goal);
  const lastBuild = targets.filter((t) => t.phase === "build").at(-1)?.targetM ?? 0;
  if (lastBuild < peakM * 0.85) {
    const weeksShort = Math.ceil(Math.log(peakM / Math.max(input.baseline.weeklyM, peakM * 0.35)) / Math.log(1 + RAMP_MAX)) - targets.filter((t) => t.phase === "build").length;
    if (weeksShort > 0) warnings.push(`About ${weeksShort} more build week${weeksShort === 1 ? "" : "s"} would be needed to reach full ${input.goal} volume at a safe ramp.`);
  }

  const weeks: PlanWeek[] = targets.map((t, i) => {
    const ws = addDays(firstWeek, 7 * i);
    const workouts = layoutWeek(ws, t.targetM, t.phase, {
      daysPerWeek: runDays.length,
      runDays,
      qualityDay,
      longRunDay,
      liftDays: lifts.liftDays,
      qualityKind: i % 2 === 0 ? "tempo" : "intervals",
      goalM,
      raceDate: input.raceDate,
    });
    return { week: localDateKey(ws), phase: t.phase, targetM: t.targetM, workouts };
  });

  // Days before the start date in the first week are not prescribed.
  for (const w of weeks[0].workouts) {
    if (w.date < input.startDate) {
      w.kind = "rest";
      w.targetDistanceM = null;
      w.notes = null;
    }
  }

  return { weeks, peakM, warnings };
}

/**
 * Did the athlete do the planned workout? Sums all runs on the date, so a
 * run split in two by a watch pause still counts, then checks the total is
 * within MATCH_TOLERANCE of target. Rest and lift days with no distance
 * target are never "completed" by a run.
 */
export function matchWorkout(
  workout: { targetDistanceM: number | null; kind: WorkoutKind },
  runsThatDay: { id: number; distanceM: number }[],
): { completed: boolean; activityId: number | null; actualM: number } {
  const actualM = runsThatDay.reduce((a, r) => a + r.distanceM, 0);
  if (workout.targetDistanceM === null || workout.targetDistanceM <= 0 || runsThatDay.length === 0) {
    return { completed: false, activityId: null, actualM };
  }
  const ratio = actualM / workout.targetDistanceM;
  const completed = ratio >= 1 - MATCH_TOLERANCE;
  const longest = runsThatDay.reduce((a, r) => (r.distanceM > a.distanceM ? r : a));
  return { completed, activityId: completed ? longest.id : null, actualM };
}
