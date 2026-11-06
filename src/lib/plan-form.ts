import { buildProfile, type CourseProfile } from "./gpx";
import { parseGoalTime } from "./pace";
import { GOAL_DISTANCE_M, type GoalDistance, type Weekday } from "./plan";
import type { CreatePlanArgs } from "./plan-data";
import type { Units } from "./units";

export const GPX_MAX_BYTES = 8 * 1024 * 1024;

export type ParsedPlanForm =
  | { ok: true; args: Omit<CreatePlanArgs, "athleteId" | "today"> }
  | { ok: false; error: string };

/**
 * Validate the plan form. Shared by the server action that saves or
 * previews a plan and by the export route that regenerates one for
 * download, so both accept exactly the same inputs.
 */
export async function parsePlanForm(form: FormData, units: Units, today: Date): Promise<ParsedPlanForm> {
  const goal = String(form.get("goal"));
  const raceDate = String(form.get("raceDate"));
  const availableDays = weekdays(form.getAll("availableDays"));
  const longRunDay = Number(form.get("longRunDay"));
  const qualityRaw = String(form.get("qualityDay") ?? "");
  const qualityDay = qualityRaw === "" ? undefined : Number(qualityRaw);
  const hardDays = Number(form.get("hardDays") ?? 1);
  const liftDays = weekdays(form.getAll("liftDays"));
  const goalTimeText = String(form.get("goalTime") ?? "").trim();
  const treadmill = form.get("treadmill") === "on";
  const gpx = form.get("gpx");

  if (!(goal in GOAL_DISTANCE_M)) return { ok: false, error: "Pick a goal race." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) return { ok: false, error: "Enter a race date." };
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  if (new Date(`${raceDate}T00:00:00`) < tomorrow) return { ok: false, error: "The race date has to be in the future." };
  if (availableDays.length < 3 || availableDays.length > 7) return { ok: false, error: "Choose 3 to 7 days you can run." };
  if (!availableDays.includes(longRunDay as Weekday)) return { ok: false, error: "The long run day has to be one of your available days." };
  if (qualityDay !== undefined) {
    if (!availableDays.includes(qualityDay as Weekday)) return { ok: false, error: "The quality day has to be one of your available days." };
    if (qualityDay === longRunDay) return { ok: false, error: "The quality day cannot be the long run day." };
  }
  if (hardDays !== 1 && hardDays !== 2) return { ok: false, error: "Choose one or two hard days." };
  if (hardDays === 2 && availableDays.length < 6) return { ok: false, error: "Two hard days need six or seven available days." };
  if (liftDays.length > 3) return { ok: false, error: "Choose at most three lifting days." };

  let goalTimeS: number | undefined;
  if (goalTimeText) {
    const parsed = parseGoalTime(goalTimeText);
    if (parsed === null) return { ok: false, error: "Goal time should look like 1:45:00 or 45:30." };
    const paceSPerKm = parsed / (GOAL_DISTANCE_M[goal as GoalDistance] / 1000);
    if (paceSPerKm < 150 || paceSPerKm > 900) return { ok: false, error: "That goal time works out to an unlikely pace. Check the hours and minutes." };
    goalTimeS = parsed;
  }

  let course: CourseProfile | undefined;
  if (gpx instanceof File && gpx.size > 0) {
    if (gpx.size > GPX_MAX_BYTES) return { ok: false, error: "The GPX file is over 8 MB. Export the course at a lower point density." };
    try {
      course = buildProfile(await gpx.text());
    } catch (err) {
      return { ok: false, error: `Could not read the GPX file: ${err instanceof Error ? err.message : "unknown error"}.` };
    }
    const expected = GOAL_DISTANCE_M[goal as GoalDistance];
    if (course.distanceM < expected * 0.6 || course.distanceM > expected * 1.6) {
      return { ok: false, error: `The GPX course is ${(course.distanceM / 1000).toFixed(1)} km, which does not match the goal distance.` };
    }
  }

  return {
    ok: true,
    args: {
      goal: goal as GoalDistance,
      raceDate,
      availableDays,
      longRunDay: longRunDay as Weekday,
      qualityDay: qualityDay as Weekday | undefined,
      hardDays,
      liftDays,
      goalTimeS,
      course,
      treadmill,
      units,
    },
  };
}

/** Checkbox values to a sorted, de-duplicated list of weekdays. */
export function weekdays(values: FormDataEntryValue[]): Weekday[] {
  const days = values.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) as Weekday[];
  return [...new Set(days)].sort((a, b) => a - b);
}
