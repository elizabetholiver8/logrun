"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../db";
import { athletes } from "../../db/schema";
import { applyCheckin, runCheckin } from "../../lib/checkin-data";
import { getSession, isDemoSession } from "../../lib/session";
import { unitsFromPreference } from "../../lib/units";

export type CheckinActionState = { error?: string; applied?: number } | undefined;

/** Ask the model for this week's check-in. Refused in the demo, which shows a stored one. */
export async function runCheckinAction(): Promise<CheckinActionState> {
  const session = await getSession();
  if (!session) redirect("/");
  if (isDemoSession(session)) return { error: "Check-ins are precomputed in the demo." };
  const athlete = await db.query.athletes.findFirst({ where: eq(athletes.id, session.athleteId) });
  const result = await runCheckin(session.athleteId, unitsFromPreference(athlete?.measurementPreference));
  if (!result.ok) return { error: result.error };
  revalidatePath("/plan");
  return {};
}

export async function applyCheckinAction(_prev: CheckinActionState, form: FormData): Promise<CheckinActionState> {
  const session = await getSession();
  if (!session) redirect("/");
  if (isDemoSession(session)) return { error: "Plan changes are off in the demo." };
  const id = Number(form.get("checkinId"));
  if (!Number.isInteger(id)) return { error: "Bad request." };
  const result = await applyCheckin(session.athleteId, id);
  if (!result.ok) return { error: result.error };
  revalidatePath("/plan");
  return { applied: result.changed };
}
