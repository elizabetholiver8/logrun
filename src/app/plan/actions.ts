"use server";

import { redirect } from "next/navigation";
import { createPlan, deletePlan } from "../../lib/plan-data";
import type { GoalDistance, PlanInput, Weekday } from "../../lib/plan";
import { getSession } from "../../lib/session";

export type PlanFormState = { error?: string } | undefined;

const GOALS: GoalDistance[] = ["5k", "10k", "half", "marathon"];

/**
 * Server action behind the /plan/new form. Validates, generates, stores,
 * then redirects to the calendar. Validation errors come back to the form.
 */
export async function createPlanAction(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const session = await getSession();
  if (!session) redirect("/");

  const goal = String(form.get("goal"));
  const raceDate = String(form.get("raceDate"));
  const daysPerWeek = Number(form.get("daysPerWeek"));
  const longRunDay = Number(form.get("longRunDay"));
  const liftDays = form.getAll("liftDays").map(Number).filter((d) => d >= 0 && d <= 6) as Weekday[];

  if (!GOALS.includes(goal as GoalDistance)) return { error: "Pick a goal distance." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) return { error: "Pick a race date." };
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (raceDate <= todayKey) return { error: "Race date has to be in the future." };
  if (![3, 4, 5, 6].includes(daysPerWeek)) return { error: "Choose 3 to 6 running days per week." };
  if (!(longRunDay >= 0 && longRunDay <= 6)) return { error: "Pick a long run day." };
  if (liftDays.length > 3) return { error: "Choose at most three lifting days." };

  await createPlan({
    athleteId: session.athleteId,
    goal: goal as GoalDistance,
    raceDate,
    daysPerWeek: daysPerWeek as PlanInput["daysPerWeek"],
    liftDays,
    longRunDay: longRunDay as Weekday,
    today,
  });
  redirect("/plan");
}

export async function deletePlanAction(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");
  await deletePlan(session.athleteId);
  redirect("/dashboard");
}
