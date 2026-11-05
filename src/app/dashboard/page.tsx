import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountControls } from "../../components/account-controls";
import { DemoBanner } from "../../components/demo-banner";
import { PlanStrip } from "../../components/plan-strip";
import { StatTile } from "../../components/stat-tile";
import { WeeklyCharts } from "../../components/weekly-charts";
import { loadDashboard } from "../../lib/dashboard-data";
import { loadPlan } from "../../lib/plan-data";
import { getSession, isDemoSession } from "../../lib/session";
import {
  formatDistance, formatDuration, formatHours, formatPace, localDateKey, paceSecondsPer,
  unitLabel, unitsFromPreference,
} from "../../lib/units";

export default function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-6 md:p-8">
      <header className="flex items-baseline justify-between">
        <Link href="/" className="text-2xl font-semibold">logrun</Link>
      </header>
      <Suspense fallback={<p className="text-neutral-400">Loading…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/");

  const [data, planView] = await Promise.all([loadDashboard(session.athleteId), loadPlan(session.athleteId)]);
  if (!data) redirect("/");

  const { athlete, last30, thisWeek, weekly, recent } = data;
  const units = unitsFromPreference(athlete.measurementPreference);
  const u = unitLabel(units);
  const name = `${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`.trim() || String(athlete.id);
  const demo = isDemoSession(session);

  return (
    <>
      {demo && <DemoBanner />}
      <AccountControls name={name} backfillComplete={Boolean(athlete.backfillCompletedAt)} demo={demo} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Runs, 30 days" value={String(last30.runs)} />
        <StatTile label="Distance, 30 days" value={formatDistance(last30.distanceM, units)} unit={u} />
        <StatTile label="Time, 30 days" value={formatHours(last30.movingTimeS)} unit="h" />
        <StatTile label="This week" value={formatDistance(thisWeek.distanceM, units)} unit={u} />
      </section>

      <PlanStrip view={planView} units={units} today={localDateKey(new Date())} />

      <WeeklyCharts weekly={weekly} units={units} />

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Recent runs</h2>
        {recent.length === 0 ? (
          <p className="text-neutral-500">{demo ? "The demo has not been seeded yet." : "No runs yet. Use Sync history to pull your Strava activities."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Run</th>
                  <th className="py-2 pr-4 text-right font-medium">{u}</th>
                  <th className="py-2 pr-4 text-right font-medium">Time</th>
                  <th className="py-2 pr-4 text-right font-medium">Pace</th>
                  <th className="py-2 text-right font-medium">Elev</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-200">
                    <td className="py-2 pr-4 whitespace-nowrap tabular-nums text-neutral-600">
                      {formatLocalDate(r.startDateLocal)}
                    </td>
                    <td className="py-2 pr-4">
                      <Link href={`/runs/${r.id}`} className="hover:underline">{r.name}</Link>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatDistance(r.distanceM, units)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatDuration(r.movingTimeS)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatPace(paceSecondsPer(r.distanceM, r.movingTimeS, units))}</td>
                    <td className="py-2 text-right tabular-nums text-neutral-600">
                      {r.totalElevationGainM === null || (r.totalElevationGainM === 0 && !r.hasGps) ? "–" : formatElevation(r.totalElevationGainM, units)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function formatLocalDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function formatElevation(m: number, units: ReturnType<typeof unitsFromPreference>): string {
  return units === "miles" ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`;
}
