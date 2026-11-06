"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "../../db";
import { athletes } from "../../db/schema";
import { createPlan, deletePlan, previewPlan, type PlanView } from "../../lib/plan-data";
import { parsePlanForm } from "../../lib/plan-form";
import { getSession, isDemoSession } from "../../lib/session";
import { unitsFromPreference } from "../../lib/units";

export type PlanFormState =
  | { error?: string; preview?: { view: PlanView; warnings: string[] } }
  | undefined;

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

  const athlete = await db.query.athletes.findFirst({ where: eq(athletes.id, session.athleteId) });
  const today = new Date();
  const parsed = await parsePlanForm(form, unitsFromPreference(athlete?.measurementPreference), today);
  if (!parsed.ok) return { error: parsed.error };

  const args = { ...parsed.args, athleteId: session.athleteId, today };
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
