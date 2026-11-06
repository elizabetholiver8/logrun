import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { activities, planWorkouts, trainingPlans } from "../db/schema";
import type { CourseProfile } from "./gpx";
import {
  GOAL_DISTANCE_M, computeBaseline, generatePlan, matchWorkout,
  type GeneratedPlan, type GoalDistance, type PlanInput, type Weekday,
} from "./plan";
import { localDateKey, type Units } from "./units";

const BASELINE_LOOKBACK_DAYS = 42;

/**
 * Load the athlete's recent runs and compute the baseline the generator
 * needs. `goal` sets the distance a run must reach to count toward best
 * pace: half the race.
 */
export async function loadBaseline(athleteId: number, today = new Date(), goal?: GoalDistance) {
  const since = new Date(today.getTime() - BASELINE_LOOKBACK_DAYS * 86400_000);
  const runs = await db
    .select({ startDateLocal: activities.startDateLocal, distanceM: activities.distanceM, movingTimeS: activities.movingTimeS })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), gte(activities.startDate, since)));
  return computeBaseline(runs, today, goal ? GOAL_DISTANCE_M[goal] / 2 : 0);
}

export type CreatePlanArgs = {
  athleteId: number;
  goal: GoalDistance;
  raceDate: string;
  /** Weekdays the athlete can run, long run day included. 3 to 7 days. */
  availableDays: Weekday[];
  longRunDay: Weekday;
  /** Omit to let the generator pick. */
  qualityDay?: Weekday;
  hardDays: 1 | 2;
  liftDays: Weekday[];
  goalTimeS?: number;
  course?: CourseProfile;
  treadmill: boolean;
  units: Units;
  today?: Date;
};

function planInput(args: CreatePlanArgs, baseline: PlanInput["baseline"], today: Date): PlanInput {
  return {
    goal: args.goal,
    raceDate: args.raceDate,
    startDate: localDateKey(today),
    availableDays: args.availableDays,
    longRunDay: args.longRunDay,
    qualityDay: args.qualityDay,
    hardDays: args.hardDays,
    liftDays: args.liftDays,
    goalTimeS: args.goalTimeS,
    course: args.course,
    treadmill: args.treadmill,
    units: args.units,
    baseline,
  };
}

function planRow(args: CreatePlanArgs, plan: GeneratedPlan) {
  return {
    athleteId: args.athleteId,
    goalDistanceM: GOAL_DISTANCE_M[args.goal],
    raceDate: args.raceDate,
    daysPerWeek: args.availableDays.length,
    liftDays: args.liftDays,
    runDays: args.availableDays,
    longRunDay: args.longRunDay,
    qualityDay: args.qualityDay ?? null,
    hardDays: args.hardDays,
    goalTimeS: args.goalTimeS ?? null,
    treadmill: args.treadmill,
    paceZones: plan.zones,
    course: args.course ?? null,
  };
}

/**
 * Generate and persist a plan, replacing any existing plan for the athlete.
 * Returns the stored plan id and the generator's warnings for display.
 */
export async function createPlan(args: CreatePlanArgs): Promise<{ planId: number; plan: GeneratedPlan }> {
  const today = args.today ?? new Date();
  const baseline = await loadBaseline(args.athleteId, today, args.goal);
  const plan = generatePlan(planInput(args, baseline, today));

  // One plan per athlete. Delete cascades to plan_workouts.
  await db.delete(trainingPlans).where(eq(trainingPlans.athleteId, args.athleteId));
  const [row] = await db.insert(trainingPlans).values(planRow(args, plan)).returning();

  const rows = plan.weeks.flatMap((w) =>
    w.workouts.map((d) => ({
      planId: row.id,
      date: d.date,
      kind: d.kind,
      targetDistanceM: d.targetDistanceM,
      targetDurationS: null,
      paceMinSPerKm: d.paceSPerKm?.[0] ?? null,
      paceMaxSPerKm: d.paceSPerKm?.[1] ?? null,
      notes: d.notes,
    })),
  );
  // Insert in chunks; Neon's HTTP driver has a request size limit.
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(planWorkouts).values(rows.slice(i, i + 100));
  }
  return { planId: row.id, plan };
}

export type PlanDay = {
  id: number;
  date: string;
  kind: typeof planWorkouts.$inferSelect.kind;
  targetDistanceM: number | null;
  /** Seconds per km, slow then fast. */
  pace: [number, number] | null;
  notes: string | null;
  completed: boolean;
  actualM: number;
  activityId: number | null;
  /** The run that satisfied the day, or the longest run that day when none did. */
  actualRun: { id: number; name: string; distanceM: number; movingTimeS: number } | null;
};

export type PlanView = {
  plan: typeof trainingPlans.$inferSelect;
  goal: GoalDistance;
  weeks: { week: string; days: PlanDay[]; targetM: number; actualM: number }[];
};

export function goalFromDistance(m: number): GoalDistance {
  let best: GoalDistance = "5k";
  for (const g of Object.keys(GOAL_DISTANCE_M) as GoalDistance[]) {
    if (Math.abs(GOAL_DISTANCE_M[g] - m) < Math.abs(GOAL_DISTANCE_M[best] - m)) best = g;
  }
  return best;
}

type WorkoutLike = Pick<PlanDay, "id" | "date" | "kind" | "targetDistanceM" | "notes"> & {
  paceMinSPerKm?: number | null;
  paceMaxSPerKm?: number | null;
};
type RunLike = { id: number; name: string; distanceM: number; movingTimeS: number; startDateLocal: Date };

/**
 * Group workouts into weeks and mark completion against runs. Shared by the
 * saved plan and the demo preview so the two can never disagree about what
 * counts as done.
 */
export function buildWeeks(workouts: WorkoutLike[], runs: RunLike[]): PlanView["weeks"] {
  const runsByDay = new Map<string, RunLike[]>();
  for (const r of runs) {
    const key = localDateKey(r.startDateLocal);
    const list = runsByDay.get(key) ?? [];
    list.push(r);
    runsByDay.set(key, list);
  }

  const weeks: PlanView["weeks"] = [];
  for (let i = 0; i < workouts.length; i += 7) {
    const chunk = workouts.slice(i, i + 7);
    const days: PlanDay[] = chunk.map((w) => {
      const dayRuns = runsByDay.get(w.date) ?? [];
      const m = matchWorkout(w, dayRuns);
      const longest = dayRuns.length ? dayRuns.reduce((a, r) => (r.distanceM > a.distanceM ? r : a)) : null;
      const pace: [number, number] | null =
        w.paceMinSPerKm != null && w.paceMaxSPerKm != null ? [w.paceMinSPerKm, w.paceMaxSPerKm] : null;
      return {
        id: w.id,
        date: w.date,
        kind: w.kind,
        targetDistanceM: w.targetDistanceM,
        pace,
        notes: w.notes,
        completed: m.completed,
        actualM: m.actualM,
        activityId: m.activityId,
        actualRun: longest ? { id: longest.id, name: longest.name, distanceM: longest.distanceM, movingTimeS: longest.movingTimeS } : null,
      };
    });
    weeks.push({
      week: chunk[0].date,
      days,
      targetM: days.reduce((a, d) => a + (d.targetDistanceM ?? 0), 0),
      actualM: days.reduce((a, d) => a + d.actualM, 0),
    });
  }
  return weeks;
}

async function loadRunsBetween(athleteId: number, first: string, last: string): Promise<RunLike[]> {
  return db
    .select({ id: activities.id, name: activities.name, distanceM: activities.distanceM, movingTimeS: activities.movingTimeS, startDateLocal: activities.startDateLocal })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        gte(activities.startDateLocal, new Date(`${first}T00:00:00`)),
        lte(activities.startDateLocal, new Date(`${last}T23:59:59`)),
      ),
    );
}

/**
 * Load the athlete's plan with completion computed against synced runs.
 * Completion is derived at read time rather than stored, so a run synced
 * after the fact, or a deleted one, is reflected without a reconciliation job.
 */
export async function loadPlan(athleteId: number): Promise<PlanView | null> {
  const plan = await db.query.trainingPlans.findFirst({ where: eq(trainingPlans.athleteId, athleteId) });
  if (!plan) return null;

  const workouts = await db
    .select()
    .from(planWorkouts)
    .where(eq(planWorkouts.planId, plan.id))
    .orderBy(asc(planWorkouts.date));
  if (workouts.length === 0) return { plan, goal: goalFromDistance(plan.goalDistanceM), weeks: [] };

  const runs = await loadRunsBetween(athleteId, workouts[0].date, workouts[workouts.length - 1].date);
  return { plan, goal: goalFromDistance(plan.goalDistanceM), weeks: buildWeeks(workouts, runs) };
}

/**
 * Generate a plan and match it against the athlete's runs without storing
 * anything. Used by the demo, where one shared athlete means a saved plan
 * would be overwritten by the next visitor. Same inputs and same generator
 * as createPlan; only the persistence step is missing.
 */
export async function previewPlan(args: CreatePlanArgs): Promise<{ view: PlanView; warnings: string[] }> {
  const today = args.today ?? new Date();
  const baseline = await loadBaseline(args.athleteId, today, args.goal);
  const plan = generatePlan(planInput(args, baseline, today));
  const workouts: WorkoutLike[] = plan.weeks
    .flatMap((w) => w.workouts)
    .map((d, i) => ({ id: i + 1, date: d.date, kind: d.kind, targetDistanceM: d.targetDistanceM, notes: d.notes, paceMinSPerKm: d.paceSPerKm?.[0], paceMaxSPerKm: d.paceSPerKm?.[1] }));
  const runs = workouts.length ? await loadRunsBetween(args.athleteId, workouts[0].date, workouts[workouts.length - 1].date) : [];
  const view: PlanView = {
    plan: { id: 0, createdAt: today, ...planRow(args, plan) },
    goal: args.goal,
    weeks: buildWeeks(workouts, runs),
  };
  return { view, warnings: plan.warnings };
}

export async function deletePlan(athleteId: number): Promise<void> {
  await db.delete(trainingPlans).where(eq(trainingPlans.athleteId, athleteId));
}
