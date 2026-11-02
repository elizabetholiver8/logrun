import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { activities, planWorkouts, trainingPlans } from "../db/schema";
import {
  GOAL_DISTANCE_M, computeBaseline, generatePlan, matchWorkout,
  type GeneratedPlan, type GoalDistance, type PlanInput, type Weekday,
} from "./plan";
import { localDateKey } from "./units";

const BASELINE_LOOKBACK_DAYS = 42;

/** Load the athlete's recent runs and compute the baseline the generator needs. */
export async function loadBaseline(athleteId: number, today = new Date()) {
  const since = new Date(today.getTime() - BASELINE_LOOKBACK_DAYS * 86400_000);
  const runs = await db
    .select({ startDateLocal: activities.startDateLocal, distanceM: activities.distanceM })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), gte(activities.startDate, since)));
  return computeBaseline(runs, today);
}

export type CreatePlanArgs = {
  athleteId: number;
  goal: GoalDistance;
  raceDate: string;
  daysPerWeek: PlanInput["daysPerWeek"];
  liftDays: Weekday[];
  longRunDay?: Weekday;
  today?: Date;
};

/**
 * Generate and persist a plan, replacing any existing plan for the athlete.
 * Returns the stored plan id and the generator's warnings for display.
 */
export async function createPlan(args: CreatePlanArgs): Promise<{ planId: number; plan: GeneratedPlan }> {
  const today = args.today ?? new Date();
  const baseline = await loadBaseline(args.athleteId, today);
  const plan = generatePlan({
    goal: args.goal,
    raceDate: args.raceDate,
    startDate: localDateKey(today),
    daysPerWeek: args.daysPerWeek,
    liftDays: args.liftDays,
    longRunDay: args.longRunDay,
    baseline,
  });

  // One plan per athlete. Delete cascades to plan_workouts.
  await db.delete(trainingPlans).where(eq(trainingPlans.athleteId, args.athleteId));
  const [row] = await db
    .insert(trainingPlans)
    .values({
      athleteId: args.athleteId,
      goalDistanceM: GOAL_DISTANCE_M[args.goal],
      raceDate: args.raceDate,
      daysPerWeek: args.daysPerWeek,
      liftDays: args.liftDays,
    })
    .returning();

  const rows = plan.weeks.flatMap((w) =>
    w.workouts.map((d) => ({
      planId: row.id,
      date: d.date,
      kind: d.kind,
      targetDistanceM: d.targetDistanceM,
      targetDurationS: null,
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
  notes: string | null;
  completed: boolean;
  actualM: number;
  activityId: number | null;
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

  const first = workouts[0].date;
  const last = workouts[workouts.length - 1].date;
  const runs = await db
    .select({ id: activities.id, distanceM: activities.distanceM, startDateLocal: activities.startDateLocal })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        gte(activities.startDateLocal, new Date(`${first}T00:00:00`)),
        lte(activities.startDateLocal, new Date(`${last}T23:59:59`)),
      ),
    );
  const runsByDay = new Map<string, { id: number; distanceM: number }[]>();
  for (const r of runs) {
    const key = localDateKey(r.startDateLocal);
    const list = runsByDay.get(key) ?? [];
    list.push({ id: r.id, distanceM: r.distanceM });
    runsByDay.set(key, list);
  }

  const weeks: PlanView["weeks"] = [];
  for (let i = 0; i < workouts.length; i += 7) {
    const chunk = workouts.slice(i, i + 7);
    const days: PlanDay[] = chunk.map((w) => {
      const m = matchWorkout(w, runsByDay.get(w.date) ?? []);
      return {
        id: w.id,
        date: w.date,
        kind: w.kind,
        targetDistanceM: w.targetDistanceM,
        notes: w.notes,
        completed: m.completed,
        actualM: m.actualM,
        activityId: m.activityId,
      };
    });
    weeks.push({
      week: chunk[0].date,
      days,
      targetM: days.reduce((a, d) => a + (d.targetDistanceM ?? 0), 0),
      actualM: days.reduce((a, d) => a + d.actualM, 0),
    });
  }
  return { plan, goal: goalFromDistance(plan.goalDistanceM), weeks };
}

export async function deletePlan(athleteId: number): Promise<void> {
  await db.delete(trainingPlans).where(eq(trainingPlans.athleteId, athleteId));
}
