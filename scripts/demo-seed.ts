/**
 * Seed the read-only demo athlete from a demo-export.json file.
 *
 *   npx tsx scripts/demo-seed.ts [--file demo-export.json] [--polylines 20] [--tz America/New_York]
 *
 * Re-runnable: wipes the demo athlete's runs and plan, then rebuilds them.
 * Dates are shifted so the newest run is today, which means the demo goes
 * stale as the calendar moves on; run this again whenever it should look
 * current. Reads DATABASE_URL from .env.local, so point that at the database
 * you mean to seed.
 */
import * as nextEnvModule from "@next/env";
import { readFileSync } from "node:fs";

// @next/env is a bundled CommonJS module. Loaded as ESM its exports sit under
// `default`; loaded as CommonJS they are on the namespace. Handle both so the
// script runs whether or not package.json says "type": "module".
const nextEnv = "loadEnvConfig" in nextEnvModule ? nextEnvModule : (nextEnvModule as unknown as { default: typeof nextEnvModule }).default;
nextEnv.loadEnvConfig(process.cwd());

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PLAN_WEEKS_ALREADY_RUN = 3;
const PLAN_TOTAL_WEEKS = 16;

async function main() {
  const file = flag("file", "demo-export.json");
  const keepPolylines = Number(flag("polylines", "20"));
  const timeZone = flag("tz", "America/New_York");

  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { activities, athletes, trainingPlans } = await import("../src/db/schema");
  const { DEMO_ATHLETE_ID, DEMO_FIRST_NAME, DEMO_LAST_NAME, transformExport } = await import("../src/lib/demo");
  const { createPlan } = await import("../src/lib/plan-data");
  const { localDateKey } = await import("../src/lib/units");

  const exported = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(exported) || exported.length === 0) throw new Error(`${file} holds no runs`);

  const today = new Date();
  const runs = transformExport(exported, today, { keepPolylines, timeZone });
  const newest = runs[runs.length - 1];

  await db
    .insert(athletes)
    .values({
      id: DEMO_ATHLETE_ID,
      firstName: DEMO_FIRST_NAME,
      lastName: DEMO_LAST_NAME,
      measurementPreference: "feet",
      backfillCompletedAt: today,
      newestActivityAt: newest.startDate,
    })
    .onConflictDoUpdate({
      target: athletes.id,
      set: { firstName: DEMO_FIRST_NAME, lastName: DEMO_LAST_NAME, backfillCompletedAt: today, newestActivityAt: newest.startDate, updatedAt: today },
    });

  await db.delete(trainingPlans).where(eq(trainingPlans.athleteId, DEMO_ATHLETE_ID));
  await db.delete(activities).where(eq(activities.athleteId, DEMO_ATHLETE_ID));

  const rows = runs.map((r) => ({ ...r, athleteId: DEMO_ATHLETE_ID, raw: { demo: true } }));
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(activities).values(rows.slice(i, i + 100));
  }

  // A plan that started a few weeks ago, so the calendar shows completed
  // days against the seeded history as well as the weeks ahead.
  const planStart = new Date(today);
  planStart.setDate(planStart.getDate() - 7 * PLAN_WEEKS_ALREADY_RUN);
  const race = new Date(planStart);
  race.setDate(race.getDate() + 7 * PLAN_TOTAL_WEEKS - race.getDay()); // a Sunday
  const { plan } = await createPlan({
    athleteId: DEMO_ATHLETE_ID,
    goal: "half",
    raceDate: localDateKey(race),
    runDays: [0, 2, 4, 5, 6],
    longRunDay: 0,
    liftDays: [1, 3],
    today: planStart,
  });

  const withGps = runs.filter((r) => r.summaryPolyline).length;
  console.log(`seeded ${runs.length} runs for athlete ${DEMO_ATHLETE_ID}, ${withGps} with GPS, newest ${localDateKey(newest.startDateLocal)}`);
  console.log(`half marathon plan: ${plan.weeks.length} weeks, race ${localDateKey(race)}${plan.warnings.length ? `, warnings: ${plan.warnings.join(" ")}` : ""}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
