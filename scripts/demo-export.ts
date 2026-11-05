/**
 * Export one athlete's synced runs to a compact JSON file for seeding the
 * demo. Keeps only the numbers and the route polyline; no names, IDs or
 * raw Strava payloads leave the database.
 *
 *   npx tsx scripts/demo-export.ts <athleteId> [out=demo-export.json]
 *
 * Reads DATABASE_URL from .env.local. The output contains GPS tracks, so do
 * not commit it; it is listed in .gitignore.
 */
import * as nextEnvModule from "@next/env";
import { writeFileSync } from "node:fs";

// @next/env is a bundled CommonJS module. Loaded as ESM its exports sit under
// `default`; loaded as CommonJS they are on the namespace. Handle both so the
// script runs whether or not package.json says "type": "module".
const nextEnv = "loadEnvConfig" in nextEnvModule ? nextEnvModule : (nextEnvModule as unknown as { default: typeof nextEnvModule }).default;
nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const [idArg, out = "demo-export.json"] = process.argv.slice(2);
  const athleteId = Number(idArg);
  if (!Number.isInteger(athleteId)) {
    console.error("usage: npx tsx scripts/demo-export.ts <athleteId> [out.json]");
    process.exit(1);
  }
  // Imported after the env is loaded so the lazy db client sees DATABASE_URL.
  const { asc, eq } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { activities } = await import("../src/db/schema");

  const rows = await db
    .select({
      d: activities.distanceM,
      t: activities.movingTimeS,
      e: activities.elapsedTimeS,
      g: activities.totalElevationGainM,
      s: activities.startDate,
      p: activities.summaryPolyline,
      h: activities.averageHeartrate,
    })
    .from(activities)
    .where(eq(activities.athleteId, athleteId))
    .orderBy(asc(activities.startDate));

  const compact = rows.map((r) => ({
    d: r.d,
    t: r.t,
    e: r.e,
    g: r.g ?? 0,
    s: r.s.toISOString(),
    p: r.p ?? "",
    h: r.h,
  }));
  writeFileSync(out, JSON.stringify(compact));
  console.log(`${compact.length} rows written to ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
