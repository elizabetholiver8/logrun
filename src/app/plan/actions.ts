"use server";

import { redirect } from "next/navigation";
import { createPlan, deletePlan, previewPlan, type PlanView } from "../../lib/plan-data";
import type { GoalDistance, Weekday } from "../../lib/plan";
import { getSession, isDemoSession } from "../../lib/session";

export type PlanFormState =
  | { error?: string; preview?: { view: PlanView; warnings: string[] } }
  | undefined;

const GOALS: GoalDistance[] = ["5k", "10k", "half", "marathon"];

/**
 * Server action behind the /plan/new form. Validates, generates, stores,
 * then redirects to the calendar. Validation errors come back to the form.
 * In the demo the plan is generated and returned for display but never
 * stored; that branch is decided server side from the signed session, so a
 * hand-made request cannot write to the shared demo athlete.
 */
export async function createPlanAction(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const session = await getSession();
  if (!session) redirect("/");

  const goal = String(form.get("goal"));
  const raceDate = String(form.get("raceDate"));
  const runDays = weekdays(form.getAll("runDays"));
  const longRunDay = Number(form.get("longRunDay"));
  const qualityRaw = String(form.get("qualityDay") ?? "");
  const qualityDay = qualityRaw === "" ? undefined : Number(qualityRaw);
  const liftDays = weekdays(form.getAll("liftDays"));

  if (!GOALS.includes(goal as GoalDistance)) return { error: "Pick a goal distance." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) return { error: "Pick a race date." };
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (raceDate <= todayKey) return { error: "Race date has to be in the future." };
  if (runDays.length < 3 || runDays.length > 6) return { error: "Choose 3 to 6 running days." };
  if (!runDays.includes(longRunDay as Weekday)) return { error: "The long run day has to be one of your running days." };
  if (qualityDay !== undefined) {
    if (!runDays.includes(qualityDay as Weekday)) return { error: "The quality day has to be one of your running days." };
    if (qualityDay === longRunDay) return { error: "The quality day cannot be the long run day." };
  }
  if (liftDays.length > 3) return { error: "Choose at most three lifting days." };

  const args = {
    athleteId: session.athleteId,
    goal: goal as GoalDistance,
    raceDate,
    runDays,
    longRunDay: longRunDay as Weekday,
    qualityDay: qualityDay as Weekday | undefined,
    liftDays,
    today,
  };
  if (isDemoSession(session)) return { preview: await previewPlan(args) };
  await createPlan(args);
  redirect("/plan");
}

export async function deletePlanAction(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");
  if (isDemoSession(session)) redirect("/plan?error=demo");
  await deletePlan(session.athleteId);
  redirect("/dashboard");
}

/** Checkbox values to a sorted, de-duplicated list of weekdays. */
function weekdays(values: FormDataEntryValue[]): Weekday[] {
  const days = values.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) as Weekday[];
  return [...new Set(days)].sort((a, b) => a - b);
}
