import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { planCheckins, planWorkouts, trainingPlans } from "../db/schema";
import { CHECKIN_SCHEMA, adjustmentUpdates, buildCheckinInput, checkinPrompt, parseCheckinResponse } from "./checkin";
import { GeminiError, generateJson } from "./gemini";
import { loadPlan } from "./plan-data";
import { localDateKey, weekStart, type Units } from "./units";

/** One check-in per athlete per this many hours. */
export const CHECKIN_COOLDOWN_HOURS = 24;

export type Checkin = typeof planCheckins.$inferSelect;

export async function loadCheckins(planId: number, limit = 12): Promise<Checkin[]> {
  return db.select().from(planCheckins).where(eq(planCheckins.planId, planId)).orderBy(desc(planCheckins.createdAt)).limit(limit);
}

export type RunCheckinResult = { ok: true; checkin: Checkin } | { ok: false; error: string };

/**
 * Build the summary, ask the model, validate, store. Errors come back as
 * messages rather than throws so the page can show them.
 */
export async function runCheckin(athleteId: number, units: Units, today = new Date()): Promise<RunCheckinResult> {
  const view = await loadPlan(athleteId);
  if (!view) return { ok: false, error: "Build a plan first." };

  const [latest] = await db
    .select({ createdAt: planCheckins.createdAt })
    .from(planCheckins)
    .where(eq(planCheckins.athleteId, athleteId))
    .orderBy(desc(planCheckins.createdAt))
    .limit(1);
  if (latest && today.getTime() - latest.createdAt.getTime() < CHECKIN_COOLDOWN_HOURS * 3600_000) {
    return { ok: false, error: `One check-in a day. The last one was ${hoursAgo(latest.createdAt, today)}.` };
  }

  const input = buildCheckinInput(view, today, units);
  let text: string;
  let model: string;
  try {
    ({ text, model } = await generateJson(checkinPrompt(input), CHECKIN_SCHEMA));
  } catch (err) {
    return { ok: false, error: err instanceof GeminiError ? err.message : "The check-in could not be generated." };
  }
  const parsed = parseCheckinResponse(text, view, today);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const [checkin] = await db
    .insert(planCheckins)
    .values({
      planId: view.plan.id,
      athleteId,
      weekStart: input.lastWeek.start || localDateKey(weekStart(today)),
      input: input as unknown as Record<string, unknown>,
      output: parsed.output,
      model,
    })
    .returning();
  return { ok: true, checkin };
}

export type ApplyResult = { ok: true; changed: number } | { ok: false; error: string };

/** Apply a stored check-in's adjustment to the plan, once. */
export async function applyCheckin(athleteId: number, checkinId: number, today = new Date()): Promise<ApplyResult> {
  const checkin = await db.query.planCheckins.findFirst({ where: and(eq(planCheckins.id, checkinId), eq(planCheckins.athleteId, athleteId)) });
  if (!checkin) return { ok: false, error: "Check-in not found." };
  if (checkin.appliedAt) return { ok: false, error: "Already applied." };
  if (checkin.output.adjustment.type === "none") return { ok: false, error: "Nothing to apply." };
  const view = await loadPlan(athleteId);
  if (!view || view.plan.id !== checkin.planId) return { ok: false, error: "That check-in belongs to a plan that no longer exists." };

  const { updates, zones } = adjustmentUpdates(checkin.output.adjustment, view, today);
  if (updates.length === 0) return { ok: false, error: "The days this would change are already in the past." };
  for (const u of updates) {
    const { id, ...fields } = u;
    await db.update(planWorkouts).set(fields).where(eq(planWorkouts.id, id));
  }
  if (zones) await db.update(trainingPlans).set({ paceZones: zones }).where(eq(trainingPlans.id, view.plan.id));
  await db.update(planCheckins).set({ appliedAt: today }).where(eq(planCheckins.id, checkinId));
  return { ok: true, changed: updates.length };
}

function hoursAgo(then: Date, now: Date): string {
  const h = Math.floor((now.getTime() - then.getTime()) / 3600_000);
  return h < 1 ? "less than an hour ago" : h === 1 ? "an hour ago" : `${h} hours ago`;
}
