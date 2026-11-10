import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DemoBanner } from "../../../components/demo-banner";
import { RunMapLoader } from "../../../components/run-map-loader";
import { StatTile } from "../../../components/stat-tile";
import { loadRun } from "../../../lib/dashboard-data";
import { getSession, isDemoSession } from "../../../lib/session";
import { db } from "../../../db";
import { athletes } from "../../../db/schema";
import { eq } from "drizzle-orm";
import {
  formatDistance, formatDuration, formatPace, paceSecondsPer, unitLabel, unitsFromPreference,
} from "../../../lib/units";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6 md:p-8">
      {/* <header className="flex items-baseline gap-4">
        <BrandLink />
        <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">Dashboard</Link>
      </header> */}
      <Suspense fallback={<p className="text-neutral-400">Loading…</p>}>
        <Run params={params} />
      </Suspense>
    </main>
  );
}

async function Run({ params }: { params: Promise<{ id: string }> }) {
  // Awaiting params here, inside Suspense, keeps the shell static and
  // lets this part stream in with the session and data.
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/");

  const runId = Number(id);
  if (!Number.isInteger(runId)) notFound();

  const [run, athlete] = await Promise.all([
    loadRun(session.athleteId, runId),
    db.query.athletes.findFirst({ where: eq(athletes.id, session.athleteId) }),
  ]);
  if (!run) notFound();

  const units = unitsFromPreference(athlete?.measurementPreference);
  const u = unitLabel(units);
  const d = run.startDateLocal;
  const when = `${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

  return (
    <>
      {isDemoSession(session) && <DemoBanner />}
      <div>
        <h1 className="text-xl font-semibold">{run.name}</h1>
        <p className="text-sm text-neutral-500">{when}</p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Distance" value={formatDistance(run.distanceM, units)} unit={u} />
        <StatTile label="Moving time" value={formatDuration(run.movingTimeS)} />
        <StatTile label="Pace" value={formatPace(paceSecondsPer(run.distanceM, run.movingTimeS, units))} unit={`/${u}`} />
        <StatTile
          label="Elevation"
          value={run.totalElevationGainM === null ? "–" : units === "miles" ? String(Math.round(run.totalElevationGainM * 3.28084)) : String(Math.round(run.totalElevationGainM))}
          unit={run.totalElevationGainM === null ? undefined : units === "miles" ? "ft" : "m"}
        />
      </section>

      {run.averageHeartrate !== null && (
        <p className="text-sm text-neutral-600">
          Heart rate: {Math.round(run.averageHeartrate)} avg
          {run.maxHeartrate !== null && `, ${Math.round(run.maxHeartrate)} max`}
        </p>
      )}

      {run.summaryPolyline ? (
        <RunMapLoader encoded={run.summaryPolyline} />
      ) : (
        <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          No GPS track for this run.
        </p>
      )}
    </>
  );
}
