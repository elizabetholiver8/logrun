import type { CheckinAdjustmentJson, CheckinOutputJson, PaceZonesJson, WorkoutKind } from "../db/schema";
import type { PlanDay, PlanView } from "./plan-data";
import { formatPaceRange } from "./plan-export";
import { formatGoalTime } from "./pace";
import { localDateKey, metersToDistance, paceSecondsPer, formatPace, unitLabel, weekStart, type Units } from "./units";

/**
 * The weekly check-in: what the model is told, what it may answer, and how
 * an answer turns into plan edits. All pure, so the prompt, the validation
 * and the edits are unit tested without a network.
 */

export const MAX_SWAP_DAYS_AHEAD = 21;
export const VOLUME_PERCENT_RANGE: [number, number] = [-25, 10];
export const PACE_PERCENT_RANGE: [number, number] = [-5, 5];
export const SWAP_KINDS = ["easy", "rest", "tempo", "intervals", "hills"] as const;

const KIND_WORD: Record<WorkoutKind, string> = {
  easy: "easy run", long: "long run", tempo: "tempo", intervals: "intervals", hills: "hill repeats", rest: "rest", lift: "rest with lifting",
};

type DayLine = {
  date: string;
  weekday: string;
  planned: string;
  actual: string | null;
  completed: boolean;
};

export type CheckinInput = {
  today: string;
  units: Units;
  goal: string;
  raceDate: string;
  weeksToRace: number;
  goalTime: string | null;
  course: string | null;
  lastWeek: { start: string; planned: number; actual: number; completedDays: number; plannedDays: number; days: DayLine[] };
  trend: { week: string; planned: number; actual: number }[];
  /** Every planned day after today through the end of next week. */
  upcoming: { nextWeekStart: string; nextWeekPlanned: number; days: DayLine[] };
};

const GOAL_LABEL = { "5k": "5K", "10k": "10K", half: "half marathon", marathon: "marathon" } as const;

function dayLine(d: PlanDay, units: Units): DayLine {
  const u = unitLabel(units);
  const plannedDist = d.targetDistanceM ? `${metersToDistance(d.targetDistanceM, units).toFixed(1)} ${u}` : "";
  const pace = formatPaceRange(d.pace, units);
  const planned = [KIND_WORD[d.kind], plannedDist, pace ? `at ${pace}` : "", d.notes && d.kind !== "easy" ? `(${d.notes})` : ""].filter(Boolean).join(" ");
  const actual = d.actualRun
    ? `${metersToDistance(d.actualRun.distanceM, units).toFixed(1)} ${u} at ${formatPace(paceSecondsPer(d.actualRun.distanceM, d.actualRun.movingTimeS, units))} /${u}`
    : null;
  return {
    date: d.date,
    weekday: new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }),
    planned,
    actual,
    completed: d.completed,
  };
}

/** Everything the model sees, built from the plan view. Small on purpose. */
export function buildCheckinInput(view: PlanView, today: Date, units: Units): CheckinInput {
  const todayKey = localDateKey(today);
  const thisMonday = localDateKey(weekStart(today));
  const lastMonday = localDateKey(new Date(weekStart(today).getTime() - 7 * 86400_000));
  const byWeek = new Map(view.weeks.map((w) => [w.week, w]));
  // "Last week" is the most recent full week; early in a plan that may be the current one.
  const last = byWeek.get(lastMonday) ?? byWeek.get(thisMonday) ?? view.weeks[0];
  const nextMonday = localDateKey(new Date(weekStart(today).getTime() + 7 * 86400_000));
  const next = byWeek.get(nextMonday) ?? view.weeks.find((w) => w.week > thisMonday) ?? view.weeks[view.weeks.length - 1];
  const upcomingDays = view.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date > todayKey && d.date <= next.days[6].date);
  const trendWeeks = view.weeks.filter((w) => w.week <= last.week).slice(-4);
  const race = view.plan.raceDate;
  const weeksToRace = Math.max(0, Math.round((new Date(`${race}T00:00:00`).getTime() - today.getTime()) / (7 * 86400_000)));
  const course = view.plan.course
    ? `${view.plan.course.category} course, ${Math.round(view.plan.course.gainM * (units === "miles" ? 3.28084 : 1))} ${units === "miles" ? "ft" : "m"} of climbing` +
      (view.plan.course.longestClimb ? `, longest climb ${metersToDistance(view.plan.course.longestClimb.lengthM, units).toFixed(1)} ${unitLabel(units)} at ${view.plan.course.longestClimb.gradePct}%` : "")
    : null;
  const miles = (m: number) => Math.round(metersToDistance(m, units) * 10) / 10;
  return {
    today: todayKey,
    units,
    goal: GOAL_LABEL[view.goal],
    raceDate: race,
    weeksToRace,
    goalTime: view.plan.goalTimeS ? formatGoalTime(view.plan.goalTimeS) : null,
    course,
    lastWeek: {
      start: last.week,
      planned: miles(last.targetM),
      actual: miles(last.actualM),
      completedDays: last.days.filter((d) => d.completed).length,
      plannedDays: last.days.filter((d) => d.targetDistanceM).length,
      days: last.days.map((d) => dayLine(d, units)),
    },
    trend: trendWeeks.map((w) => ({ week: w.week, planned: miles(w.targetM), actual: miles(w.actualM) })),
    upcoming: { nextWeekStart: next.week, nextWeekPlanned: miles(next.targetM), days: upcomingDays.map((d) => dayLine(d, units)) },
  };
}

/** JSON Schema the model must answer in. Lowercase types, as the API expects. */
export const CHECKIN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One short paragraph, 60 to 120 words, written to the runner in plain language." },
    highlights: { type: "array", items: { type: "string" }, description: "Two or three things that went well, one sentence each." },
    concerns: { type: "array", items: { type: "string" }, description: "Zero to three things to watch, one sentence each. Empty when nothing is wrong." },
    adjustment: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["none", "scale_volume", "swap_workout", "adjust_paces"] },
        percent: { type: "number", description: "scale_volume: -25 to 10, change to next weeks' distances. adjust_paces: -5 to 5, positive makes every target pace slower." },
        weeks: { type: "integer", description: "scale_volume only: 1 or 2." },
        date: { type: "string", description: "swap_workout only: one of the upcoming dates listed, YYYY-MM-DD." },
        kind: { type: "string", enum: ["easy", "rest", "tempo", "intervals", "hills"], description: "swap_workout only: what that day becomes." },
        reason: { type: "string", description: "One sentence on why, or why no change." },
      },
      required: ["type", "reason"],
    },
  },
  required: ["summary", "highlights", "concerns", "adjustment"],
} as const;

export function checkinPrompt(input: CheckinInput): string {
  const u = input.units === "miles" ? "miles" : "kilometres";
  const day = (d: DayLine) => `  ${d.weekday} ${d.date}: planned ${d.planned || "rest"}${d.actual ? `; ran ${d.actual}` : "; no run"}${d.completed ? " (done)" : ""}`;
  return [
    "You are a running coach reviewing one athlete's week against their training plan. Be specific, warm and brief. Use the athlete's numbers. Do not invent runs or paces that are not listed. Distances are in " + u + ".",
    "",
    `Today: ${input.today}. Goal: ${input.goal} on ${input.raceDate}, ${input.weeksToRace} weeks away.${input.goalTime ? ` Goal time ${input.goalTime}.` : " No goal time set."}${input.course ? ` Course: ${input.course}.` : ""}`,
    "",
    `Last week (starting ${input.lastWeek.start}): planned ${input.lastWeek.planned}, ran ${input.lastWeek.actual}; ${input.lastWeek.completedDays} of ${input.lastWeek.plannedDays} planned runs completed.`,
    ...input.lastWeek.days.map(day),
    "",
    "Recent weeks, planned vs ran: " + input.trend.map((t) => `${t.week}: ${t.planned} vs ${t.actual}`).join("; "),
    "",
    `Coming up, through the end of next week (next week starts ${input.upcoming.nextWeekStart}, planned ${input.upcoming.nextWeekPlanned}):`,
    ...input.upcoming.days.map(day),
    "",
    "Answer in the JSON shape given. Pick exactly one adjustment:",
    "- none: the plan is fine as it is.",
    "- scale_volume: the runner missed a lot or did far more than planned; change next week's distances by percent (-25 to 10) for 1 or 2 weeks.",
    "- swap_workout: one upcoming day should be a different kind of run, for example a hard day after a missed week should become easy, or a rest day could carry an easy run if they are consistently exceeding the plan. Give the date, from the list above, and the new kind. Never the long run.",
    "- adjust_paces: actual paces are consistently faster or slower than the targets; shift every target pace by percent (-5 to 5, positive is slower).",
    "Prefer none when the week went roughly to plan. Never suggest more than one change.",
  ].join("\n");
}

export type ParsedCheckin = { ok: true; output: CheckinOutputJson } | { ok: false; error: string };

/**
 * Validate the model's JSON. The schema constrains shape, not sense: this
 * clamps numbers, checks the swap date is real and upcoming, and rejects
 * anything that would not be safe to apply.
 */
export function parseCheckinResponse(text: string, view: PlanView, today: Date): ParsedCheckin {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "The model did not return valid JSON." };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "The model's answer was not an object." };
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (summary.length < 20) return { ok: false, error: "The model's summary was missing." };
  const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, max) : []);
  const highlights = strings(o.highlights, 3);
  const concerns = strings(o.concerns, 3);
  const a = (typeof o.adjustment === "object" && o.adjustment !== null ? o.adjustment : {}) as Record<string, unknown>;
  const reason = typeof a.reason === "string" && a.reason.trim() ? a.reason.trim() : "No reason given.";
  const todayKey = localDateKey(today);
  let adjustment: CheckinAdjustmentJson;
  switch (a.type) {
    case "scale_volume": {
      const percent = clamp(Number(a.percent), VOLUME_PERCENT_RANGE);
      if (!Number.isFinite(percent) || percent === 0) return { ok: false, error: "A volume change needs a non-zero percent." };
      const weeks = Number(a.weeks) === 2 ? 2 : 1;
      adjustment = { type: "scale_volume", percent: Math.round(percent), weeks, reason };
      break;
    }
    case "adjust_paces": {
      if (!view.plan.paceZones) return { ok: false, error: "The model suggested changing paces, but this plan has no goal time." };
      const percent = clamp(Number(a.percent), PACE_PERCENT_RANGE);
      if (!Number.isFinite(percent) || percent === 0) return { ok: false, error: "A pace change needs a non-zero percent." };
      adjustment = { type: "adjust_paces", percent: Math.round(percent * 10) / 10, reason };
      break;
    }
    case "swap_workout": {
      const date = typeof a.date === "string" ? a.date : "";
      const kind = SWAP_KINDS.find((k) => k === a.kind);
      const day = view.weeks.flatMap((w) => w.days).find((d) => d.date === date);
      const limit = localDateKey(new Date(today.getTime() + MAX_SWAP_DAYS_AHEAD * 86400_000));
      if (!day || !kind) return { ok: false, error: "The model suggested a swap for a day that is not in the plan." };
      if (date <= todayKey || date > limit) return { ok: false, error: "The model suggested a swap outside the next three weeks." };
      if (date === view.plan.raceDate || day.kind === "long") return { ok: false, error: "The model tried to change the long run or race day; that is not allowed." };
      adjustment = { type: "swap_workout", date, kind, reason };
      break;
    }
    default:
      adjustment = { type: "none", reason };
  }
  return { ok: true, output: { summary, highlights, concerns, adjustment } };
}

function clamp(n: number, [lo, hi]: [number, number]): number {
  return Math.max(lo, Math.min(hi, n));
}

export type WorkoutUpdate = {
  id: number;
  kind?: WorkoutKind;
  targetDistanceM?: number | null;
  paceMinSPerKm?: number | null;
  paceMaxSPerKm?: number | null;
  notes?: string | null;
};

const SWAP_NOTES: Record<(typeof SWAP_KINDS)[number], string | null> = {
  easy: "Easy effort, swapped in by the weekly check-in",
  rest: "Rest, swapped in by the weekly check-in",
  tempo: "Warm up, then sustained comfortably hard effort, cool down",
  intervals: "Warm up, then short hard repeats with jog recoveries, cool down",
  hills: "Hill repeats: 10 min easy, then 6 x 60 s uphill at 5K effort, jog down to recover, 10 min easy",
};

/**
 * Turn an accepted adjustment into row updates. Only future days change;
 * the long run and race day are never touched. Returns the updates and the
 * new pace zones when paces shift.
 */
export function adjustmentUpdates(
  adjustment: CheckinAdjustmentJson,
  view: PlanView,
  today: Date,
): { updates: WorkoutUpdate[]; zones: PaceZonesJson | null } {
  const todayKey = localDateKey(today);
  const future = view.weeks.flatMap((w) => w.days).filter((d) => d.date > todayKey && d.date !== view.plan.raceDate);
  switch (adjustment.type) {
    case "scale_volume": {
      const factor = 1 + adjustment.percent / 100;
      const nextMonday = localDateKey(new Date(weekStart(today).getTime() + 7 * 86400_000));
      const end = localDateKey(new Date(weekStart(today).getTime() + (7 + 7 * adjustment.weeks) * 86400_000));
      const updates = future
        .filter((d) => d.date >= nextMonday && d.date < end && d.targetDistanceM)
        .map((d) => ({ id: d.id, targetDistanceM: Math.round((d.targetDistanceM! * factor) / 100) * 100 }));
      return { updates, zones: null };
    }
    case "adjust_paces": {
      const factor = 1 + adjustment.percent / 100;
      const updates = future
        .filter((d) => d.pace)
        .map((d) => ({ id: d.id, paceMinSPerKm: d.pace![0] * factor, paceMaxSPerKm: d.pace![1] * factor }));
      const z = view.plan.paceZones;
      const scale = (r: [number, number]): [number, number] => [r[0] * factor, r[1] * factor];
      const zones = z ? { vdot: z.vdot, easy: scale(z.easy), long: scale(z.long), tempo: scale(z.tempo), intervals: scale(z.intervals), race: scale(z.race) } : null;
      return { updates, zones };
    }
    case "swap_workout": {
      const day = future.find((d) => d.date === adjustment.date);
      if (!day || day.kind === "long") return { updates: [], zones: null };
      const z = view.plan.paceZones;
      const pace = adjustment.kind === "rest" || adjustment.kind === "hills" ? null : z ? z[adjustment.kind === "easy" ? "easy" : adjustment.kind] : null;
      const lift = day.kind === "lift" || Boolean(day.notes?.includes("Lift"));
      const base = SWAP_NOTES[adjustment.kind];
      return {
        updates: [{
          id: day.id,
          kind: adjustment.kind === "rest" && lift ? "lift" : adjustment.kind,
          targetDistanceM: adjustment.kind === "rest" ? null : day.targetDistanceM ?? view.weeks.find((w) => w.days.includes(day))?.days.find((d) => d.kind === "easy")?.targetDistanceM ?? 5000,
          paceMinSPerKm: pace ? pace[0] : null,
          paceMaxSPerKm: pace ? pace[1] : null,
          notes: lift ? (base ? `${base}. Lift` : "Lift") : base,
        }],
        zones: null,
      };
    }
    default:
      return { updates: [], zones: null };
  }
}

/** Human sentence for an adjustment, for the panel and the apply button. */
export function describeAdjustment(a: CheckinAdjustmentJson): string {
  switch (a.type) {
    case "scale_volume":
      return `${a.percent > 0 ? "Increase" : "Cut"} next ${a.weeks === 2 ? "two weeks'" : "week's"} distances by ${Math.abs(a.percent)} percent`;
    case "adjust_paces":
      return `Make every target pace ${Math.abs(a.percent)} percent ${a.percent > 0 ? "slower" : "faster"}`;
    case "swap_workout":
      return `Make ${new Date(`${a.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} ${a.kind === "rest" ? "a rest day" : `${KIND_WORD[a.kind]}`}`;
    default:
      return "No change";
  }
}
