import type { WorkoutKind } from "../db/schema";
import type { CourseProfile } from "./gpx";
import { paceZones, type PaceRange, type PaceZones } from "./pace";
import { METERS_PER_MILE, localDateKey, weekStart } from "./units";

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
 *    off the days next to the long run unless the athlete overrides it; a
 *    second hard day is optional and only used in weeks with 5+ run days
 *  - the athlete says which days are available; how many of them are used
 *    each week follows that week's volume, so a beginner with five free
 *    days starts on three and gains days as the build grows. Chosen days
 *    are spread evenly so rest days are never bunched
 *  - lifting goes on the requested weekdays, never the day before the long
 *    run; a conflicting pick is moved and reported
 *  - a goal time gives every run a target pace range via Daniels' formula
 *  - a course profile turns some quality sessions into hill work sized to
 *    the course, on a treadmill when the athlete has one
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
  /** Weekdays the athlete can run, 3 to 7. Must include the long run day. */
  availableDays: Weekday[];
  longRunDay: Weekday;
  /**
   * Weekday for the main quality session. Defaults to the first available
   * day that is not the long run or a day beside it. A pick next to the
   * long run is honored but reported as a warning.
   */
  qualityDay?: Weekday;
  /** One or two hard sessions a week. Two needs 6+ available days. */
  hardDays: 1 | 2;
  liftDays: Weekday[];
  /** Goal finish time in seconds. Enables target paces. */
  goalTimeS?: number;
  /** Race course profile from a GPX file. Enables hill work. */
  course?: CourseProfile;
  /** The athlete has a treadmill, so hill sessions are written as incline workouts. */
  treadmill?: boolean;
  /** Display units for note text; distances in the data stay in metres. */
  units?: "miles" | "km";
  baseline: Baseline;
};

export type Baseline = {
  /** Average meters per week over the baseline window. */
  weeklyM: number;
  /** Longest single run in the window, meters. */
  longestM: number;
  /** How many full weeks the average came from. */
  weeksOfData: number;
  /** Average runs per week over the window. */
  runsPerWeek: number;
  /** Fastest pace, s/km, among window runs of at least the reference distance. Null when none qualify. */
  bestPaceSPerKm: number | null;
};

export type PlannedWorkout = {
  date: string;
  kind: WorkoutKind;
  targetDistanceM: number | null;
  /** Seconds per km, slow then fast. Null when effort based or no goal time. */
  paceSPerKm: PaceRange | null;
  notes: string | null;
};

export type PlanWeek = {
  week: string;
  phase: "build" | "cutback" | "taper" | "race";
  targetM: number;
  runDays: number;
  workouts: PlannedWorkout[];
};

export type GeneratedPlan = {
  weeks: PlanWeek[];
  peakM: number;
  zones: PaceZones | null;
  warnings: string[];
};

type RunLike = { startDateLocal: Date; distanceM: number; movingTimeS?: number };

/**
 * Baseline from synced runs: average weekly volume, longest run, runs per
 * week and best pace over the last BASELINE_WEEKS complete weeks before
 * `today`. The current partial week is excluded so a Monday morning does
 * not read as a zero week. `paceReferenceM` is the distance a run must
 * reach to count toward best pace, normally half the goal distance.
 */
export function computeBaseline(runs: RunLike[], today: Date, paceReferenceM = 0): Baseline {
  const currentWeek = weekStart(today);
  const windowStart = new Date(currentWeek);
  windowStart.setDate(windowStart.getDate() - 7 * BASELINE_WEEKS);

  const byWeek = new Map<string, number>();
  let longestM = 0;
  let count = 0;
  let bestPaceSPerKm: number | null = null;
  for (const r of runs) {
    const ws = weekStart(r.startDateLocal);
    if (ws < windowStart || ws >= currentWeek) continue;
    const key = localDateKey(ws);
    byWeek.set(key, (byWeek.get(key) ?? 0) + r.distanceM);
    count++;
    if (r.distanceM > longestM) longestM = r.distanceM;
    if (r.movingTimeS && r.distanceM >= paceReferenceM && r.distanceM > 0) {
      const pace = r.movingTimeS / (r.distanceM / 1000);
      if (bestPaceSPerKm === null || pace < bestPaceSPerKm) bestPaceSPerKm = pace;
    }
  }
  const weeksWithData = byWeek.size;
  if (weeksWithData === 0) return { weeklyM: 0, longestM: 0, weeksOfData: 0, runsPerWeek: 0, bestPaceSPerKm: null };
  // Average over the full window, so a missed week pulls the baseline down
  // rather than being ignored; that is the honest starting point.
  const total = [...byWeek.values()].reduce((a, b) => a + b, 0);
  return { weeklyM: total / BASELINE_WEEKS, longestM, weeksOfData: weeksWithData, runsPerWeek: count / BASELINE_WEEKS, bestPaceSPerKm };
}

/** Weekly volume at which one more run day is added, in metres. */
export const DAY_THRESHOLDS_M = [24_000, 40_000, 56_000, 72_000];
/** An easy run shorter than this is not worth a day; fewer days are used instead. */
export const MIN_EASY_RUN_M = 4000;

/**
 * How many days to run in a week of `targetM`: three below the first
 * threshold, one more per threshold crossed, never below what the athlete
 * already does and never above what is available. Then trimmed so that,
 * after the long run and `hardSessions` quality days take their share, each
 * easy day still gets at least MIN_EASY_RUN_M.
 */
export function runDaysForVolume(targetM: number, availableCount: number, baselineRunsPerWeek: number, hardSessions = 1): number {
  const byVolume = 3 + DAY_THRESHOLDS_M.filter((t) => targetM >= t).length;
  const floor = Math.min(availableCount, Math.max(3, Math.round(baselineRunsPerWeek)));
  const wanted = Math.max(Math.min(availableCount, 3), Math.min(availableCount, Math.max(byVolume, floor)));
  const easyBudget = targetM * (1 - LONG_RUN_SHARE - 0.2 * hardSessions);
  const maxEasyDays = Math.max(1, Math.floor(easyBudget / MIN_EASY_RUN_M));
  return Math.max(3, Math.min(wanted, 1 + hardSessions + maxEasyDays));
}

function circularGap(a: Weekday, b: Weekday): number {
  const d = Math.abs(a - b);
  return Math.min(d, 7 - d);
}

/** Longest run of `value` in a circular week. */
function longestStreak(week: boolean[], value: boolean): number {
  if (week.every((v) => v === value)) return 7;
  let best = 0;
  let cur = 0;
  for (let i = 0; i < 14; i++) {
    if (week[i % 7] === value) {
      cur++;
      if (cur > best) best = cur;
    } else cur = 0;
  }
  return Math.min(best, 7);
}

/**
 * Pick `n` of the available days, always including `required`. Every
 * subset is scored and the best wins: the shortest streak of consecutive
 * run days first, then the shortest streak of rest days, then a rest day
 * before the long run (the first required day). Seven days give at most
 * 35 subsets, so trying them all is cheap and removes any bunching.
 */
export function selectRunDays(available: Weekday[], n: number, required: Weekday[]): Weekday[] {
  const avail = [...new Set(available)].sort((a, b) => a - b);
  const must = [...new Set(required)].filter((d) => avail.includes(d));
  const want = Math.min(Math.max(n, must.length), avail.length);
  const optional = avail.filter((d) => !must.includes(d));
  const longRunDay = required[0];

  let best: Weekday[] | null = null;
  let bestScore: number[] = [];
  const consider = (days: Weekday[]) => {
    const week = Array.from({ length: 7 }, (_, d) => days.includes(d as Weekday));
    const score = [
      longestStreak(week, true),
      longestStreak(week, false),
      longRunDay !== undefined && week[(longRunDay + 6) % 7] ? 1 : 0,
      ...days,
    ];
    if (best === null || compare(score, bestScore) < 0) {
      best = [...days].sort((a, b) => a - b);
      bestScore = score;
    }
  };
  const choose = (start: number, picked: Weekday[]) => {
    if (picked.length === want) {
      consider(picked);
      return;
    }
    for (let i = start; i < optional.length; i++) choose(i + 1, [...picked, optional[i]]);
  };
  choose(0, must);
  return best ?? must;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
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

export type QualitySession = { day: Weekday; kind: "tempo" | "intervals" | "hills" };

export type LayoutOptions = {
  runDays: Weekday[];
  longRunDay: Weekday;
  quality: QualitySession[];
  liftDays: Weekday[];
  goalM: number;
  raceDate?: string;
  zones?: PaceZones | null;
  course?: CourseProfile | null;
  treadmill?: boolean;
  units?: "miles" | "km";
};

/**
 * Lay a week's volume onto weekdays. Returns one workout per day of the
 * week, rest days included, Monday first.
 */
export function layoutWeek(
  weekStartDate: Date,
  targetM: number,
  phase: PlanWeek["phase"],
  opts: LayoutOptions,
): PlannedWorkout[] {
  const days: PlannedWorkout[] = [];
  const zones = opts.zones ?? null;
  const longM = Math.min(round100(targetM * LONG_RUN_SHARE), Math.max(opts.goalM, round100(targetM * LONG_RUN_SHARE * 0.8)));
  const runDays = opts.runDays;
  const quality = opts.quality.filter((q) => runDays.includes(q.day) && q.day !== opts.longRunDay);
  const qualityDays = quality.map((q) => q.day);
  const easyDays = runDays.filter((d) => d !== opts.longRunDay && !qualityDays.includes(d));
  const qualityM = round100(targetM * 0.2);
  const easyEach = easyDays.length > 0 ? round100(Math.max(0, targetM - longM - qualityM * quality.length) / easyDays.length) : 0;
  const hilly = opts.course && opts.course.category !== "flat" ? opts.course : null;

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStartDate, i);
    const dow = date.getDay() as Weekday;
    const key = localDateKey(date);
    const q = quality.find((x) => x.day === dow);
    let w: PlannedWorkout;
    if (phase === "race" && opts.raceDate === key) {
      w = { date: key, kind: "long", targetDistanceM: opts.goalM, paceSPerKm: zones?.race ?? null, notes: raceDayNote(opts.course ?? null, opts.units) };
    } else if (phase === "race" && opts.raceDate && key > opts.raceDate) {
      w = { date: key, kind: "rest", targetDistanceM: null, paceSPerKm: null, notes: null };
    } else if (dow === opts.longRunDay && runDays.includes(dow)) {
      const m = phase === "race" ? round100(Math.min(longM, 6000)) : longM;
      w = { date: key, kind: "long", targetDistanceM: m, paceSPerKm: zones?.long ?? null, notes: phase === "race" ? "Short shakeout, easy" : longRunNote(m, hilly, opts.units) };
    } else if (q && phase !== "taper" && phase !== "race") {
      w = qualityWorkout(key, q.kind, qualityM, zones, hilly, opts.treadmill ?? false);
    } else if (q) {
      w = { date: key, kind: "easy", targetDistanceM: qualityM, paceSPerKm: zones?.easy ?? null, notes: "Easy, with a few short strides" };
    } else if (easyDays.includes(dow)) {
      w = { date: key, kind: "easy", targetDistanceM: easyEach, paceSPerKm: zones?.easy ?? null, notes: null };
    } else {
      w = { date: key, kind: "rest", targetDistanceM: null, paceSPerKm: null, notes: null };
    }
    if (opts.liftDays.includes(dow) && w.kind !== "long" && phase !== "race") {
      w.notes = w.notes ? `${w.notes}. Lift` : "Lift";
      if (w.kind === "rest") w.kind = "lift";
    }
    days.push(w);
  }
  return days;
}

function fmtDist(m: number, units: "miles" | "km" = "miles"): string {
  return units === "miles" ? `${(m / METERS_PER_MILE).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;
}

function fmtHeight(m: number, units: "miles" | "km" = "miles"): string {
  return units === "miles" ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`;
}

/** Hill grade for repeats: the course's longest climb, kept within what a treadmill and most hills offer. */
export function hillGrade(course: CourseProfile): number {
  const g = course.longestClimb?.gradePct ?? course.maxGradePct;
  return Math.min(8, Math.max(4, Math.round(g)));
}

function qualityWorkout(
  date: string,
  kind: "tempo" | "intervals" | "hills",
  targetM: number,
  zones: PaceZones | null,
  hilly: CourseProfile | null,
  treadmill: boolean,
): PlannedWorkout {
  if (kind === "hills" && hilly) {
    const grade = hillGrade(hilly);
    const reps = hilly.category === "hilly" ? "8 x 90 s" : "6 x 60 s";
    const notes = treadmill
      ? `Treadmill hills: 10 min easy at 1% incline, then ${reps} at ${grade}% incline at 5K effort with equal easy jogs at 1%, 10 min easy. Mirrors the climbing on your course`
      : `Hill repeats: 10 min easy, then ${reps} uphill at 5K effort on a hill of about ${grade}%, jog down to recover, 10 min easy. Treadmill alternative: ${grade}% incline`;
    return { date, kind: "hills", targetDistanceM: targetM, paceSPerKm: null, notes };
  }
  if (kind === "tempo") {
    return { date, kind: "tempo", targetDistanceM: targetM, paceSPerKm: zones?.tempo ?? null, notes: "Warm up, then sustained comfortably hard effort, cool down" };
  }
  return { date, kind: "intervals", targetDistanceM: targetM, paceSPerKm: zones?.intervals ?? null, notes: "Warm up, then short hard repeats with jog recoveries, cool down" };
}

function longRunNote(longM: number, hilly: CourseProfile | null, units?: "miles" | "km"): string {
  if (!hilly || hilly.category !== "hilly") return "Easy effort";
  // Three quarters of the course's climbing rate, so long runs rehearse the
  // terrain without turning every weekend into the race.
  const climbM = hilly.gainPerKm * (longM / 1000) * 0.75;
  return `Easy effort on a hilly route, about ${fmtHeight(climbM, units)} of climbing`;
}

function raceDayNote(course: CourseProfile | null, units?: "miles" | "km"): string {
  if (!course) return "Race day";
  const climb = course.longestClimb
    ? `, longest climb ${fmtDist(course.longestClimb.lengthM, units)} at ${course.longestClimb.gradePct}% starting at ${fmtDist(course.longestClimb.startM, units)}`
    : "";
  return `Race day. ${fmtHeight(course.gainM, units)} of climbing${climb}`;
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

/**
 * Second hard day: the available day farthest from both the long run and
 * the main quality day, never beside either. Null when no such day exists.
 */
export function secondQualityDay(available: Weekday[], longRunDay: Weekday, qualityDay: Weekday): Weekday | null {
  let best: Weekday | null = null;
  let bestGap = -1;
  for (const d of available) {
    if (d === longRunDay || d === qualityDay) continue;
    if (adjacentWeekdays(d, longRunDay) || adjacentWeekdays(d, qualityDay)) continue;
    const gap = Math.min(circularGap(d, longRunDay), circularGap(d, qualityDay));
    if (gap > bestGap) {
      bestGap = gap;
      best = d;
    }
  }
  return best;
}

export function generatePlan(input: PlanInput): GeneratedPlan {
  const warnings: string[] = [];
  const start = parseLocalDate(input.startDate);
  const race = parseLocalDate(input.raceDate);
  if (race <= start) throw new Error("Race date must be after the start date");

  const longRunDay = input.longRunDay;
  const available = [...new Set(input.availableDays)].sort((a, b) => a - b);
  if (available.length < 3) throw new Error("At least three available days are needed");
  if (!available.includes(longRunDay)) throw new Error("Available days must include the long run day");
  const qualityDay = input.qualityDay ?? defaultQualityDay(available, longRunDay);
  if (!available.includes(qualityDay) || qualityDay === longRunDay) {
    throw new Error("Quality day must be an available day other than the long run day");
  }
  if (input.qualityDay !== undefined && adjacentWeekdays(qualityDay, longRunDay)) {
    warnings.push(
      `${WEEKDAY_NAMES[qualityDay]} quality sessions sit next to the ${WEEKDAY_NAMES[longRunDay]} long run, so there is no easy day between your two hardest efforts.`,
    );
  }
  let second: Weekday | null = null;
  if (input.hardDays === 2) {
    second = available.length >= 6 ? secondQualityDay(available, longRunDay, qualityDay) : null;
    if (second === null) warnings.push("A second hard day needs six or seven available days with room between hard efforts, so this plan keeps one.");
  }
  const lifts = resolveLiftDays(input.liftDays, longRunDay, second === null ? [qualityDay] : [qualityDay, second]);
  if (lifts.warning) warnings.push(lifts.warning);

  const goalM = GOAL_DISTANCE_M[input.goal];
  const zones = input.goalTimeS ? paceZones(goalM, input.goalTimeS) : null;
  if (zones) {
    const goalPace = zones.race[0];
    const best = input.baseline.bestPaceSPerKm;
    if (best === null) {
      warnings.push("No recent run of at least half the race distance to check your goal time against.");
    } else if (goalPace < best * 0.9) {
      warnings.push(
        `Goal pace is more than 10 percent faster than your fastest recent run of at least half the race distance. The paces below may be out of reach for this build.`,
      );
    }
  }
  const course = input.course ?? null;
  if (course && course.category === "flat") {
    warnings.push(`The course is flat, about ${fmtHeight(course.gainM, input.units)} of climbing, so no hill sessions were added.`);
  }

  const firstWeek = weekStart(start);
  const raceWeek = weekStart(race);
  const totalWeeks = Math.round((raceWeek.getTime() - firstWeek.getTime()) / (7 * 86400_000)) + 1;

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

  // Session kinds alternate week to week. With a course that climbs, the
  // interval slot becomes hill work.
  const secondKind: "intervals" | "hills" = course && course.category !== "flat" ? "hills" : "intervals";
  const weeks: PlanWeek[] = targets.map((t, i) => {
    const ws = addDays(firstWeek, 7 * i);
    const withSecond = second !== null && runDaysForVolume(t.targetM, available.length, input.baseline.runsPerWeek, 2) >= 5;
    const n = runDaysForVolume(t.targetM, available.length, input.baseline.runsPerWeek, withSecond ? 2 : 1);
    const useSecond = withSecond && n >= 5;
    const required: Weekday[] = useSecond && second !== null ? [longRunDay, qualityDay, second] : [longRunDay, qualityDay];
    const runDays = selectRunDays(available, n, required);
    const quality: QualitySession[] = useSecond && second !== null
      ? [{ day: qualityDay, kind: "tempo" }, { day: second, kind: secondKind }]
      : [{ day: qualityDay, kind: i % 2 === 0 ? "tempo" : secondKind }];
    const workouts = layoutWeek(ws, t.targetM, t.phase, {
      runDays,
      longRunDay,
      quality,
      liftDays: lifts.liftDays,
      goalM,
      raceDate: input.raceDate,
      zones,
      course,
      treadmill: input.treadmill ?? false,
      units: input.units,
    });
    return { week: localDateKey(ws), phase: t.phase, targetM: t.targetM, runDays: runDays.length, workouts };
  });

  // Days before the start date in the first week are not prescribed.
  for (const w of weeks[0].workouts) {
    if (w.date < input.startDate) {
      w.kind = "rest";
      w.targetDistanceM = null;
      w.paceSPerKm = null;
      w.notes = null;
    }
  }

  return { weeks, peakM, zones, warnings };
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
