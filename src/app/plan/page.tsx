import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { CheckinPanel, type CheckinSummary } from "../../components/checkin-panel";
import { CourseProfileChart } from "../../components/course-profile-chart";
import { DemoBanner } from "../../components/demo-banner";
import { PaceZonesTable } from "../../components/pace-zones-table";
import { PlanCalendarView } from "../../components/plan-calendar-view";
import { db } from "../../db";
import { athletes } from "../../db/schema";
import { loadPlan } from "../../lib/plan-data";
import { loadCheckins } from "../../lib/checkin-data";
import { geminiConfigured } from "../../lib/gemini";
import { getSession, isDemoSession } from "../../lib/session";
import { formatDistance, localDateKey, unitLabel, unitsFromPreference } from "../../lib/units";
import { deletePlanAction } from "./actions";

const GOAL_LABEL = { "5k": "5K", "10k": "10K", half: "Half marathon", marathon: "Marathon" } as const;

export default function PlanPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6 md:p-8">
      {/* <header className="flex items-baseline justify-between gap-4">
        <BrandLink />
        <Link href="/dashboard" className="inline-block rounded border bg-blue-600 px-2 py-1 text-2xl text-white font-semibold hover:bg-blue-700">dashboard</Link>
      </header> */}
      <Suspense fallback={<p className="text-neutral-400">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const session = await getSession();
  if (!session) redirect("/");
  const [view, athlete] = await Promise.all([
    loadPlan(session.athleteId),
    db.query.athletes.findFirst({ where: eq(athletes.id, session.athleteId) }),
  ]);
  if (!view) redirect("/plan/new");
  const demo = isDemoSession(session);
  const checkins: CheckinSummary[] = (await loadCheckins(view.plan.id)).map((c) => ({
    id: c.id,
    weekStart: c.weekStart,
    createdAt: c.createdAt.toISOString(),
    appliedAt: c.appliedAt?.toISOString() ?? null,
    model: c.model,
    output: c.output,
  }));

  const units = unitsFromPreference(athlete?.measurementPreference);
  const today = localDateKey(new Date());
  const peak = Math.max(...view.weeks.map((w) => w.targetM));
  const weeksLeft = view.weeks.filter((w) => w.days[6].date >= today).length;

  const buttonClass = "rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100";
  const disabledClass = "rounded border border-neutral-300 px-3 py-1 opacity-50";
  return (
    <>
      {demo && <DemoBanner />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{GOAL_LABEL[view.goal]} plan</h1>
          <p className="text-sm text-neutral-600">
            Race {formatLong(view.plan.raceDate)}. {view.weeks.length} weeks, {weeksLeft} to go. Peak week {formatDistance(peak, units)} {unitLabel(units)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <a href="/plan/export?format=ics" className={buttonClass} download>Download calendar</a>
          <a href="/plan/export?format=csv" className={buttonClass} download>Download CSV</a>
          <Link href="/plan/new" className={buttonClass}>{demo ? "Try the plan builder" : "Rebuild"}</Link>
          {demo ? (
            <span className={disabledClass} title="Deleting is off in the demo">Delete plan</span>
          ) : (
            <form action={deletePlanAction}>
              <button type="submit" className={`${buttonClass} text-neutral-600`}>Delete plan</button>
            </form>
          )}
        </div>
      </div>
      {view.plan.paceZones && view.plan.goalTimeS && (
        <PaceZonesTable zones={view.plan.paceZones} goalTimeS={view.plan.goalTimeS} units={units} />
      )}
      {view.plan.course && <CourseProfileChart course={view.plan.course} units={units} />}
      <CheckinPanel checkins={checkins} demo={demo} configured={geminiConfigured()} />
      <PlanCalendarView view={view} units={units} today={today} />
      <p className="text-xs text-neutral-500">
        A check marks a day where your synced runs reached at least 80 percent of the target. Hover a day for details, or switch on details above. Lifting is a slot, not a prescription.
      </p>
    </>
  );
}

function formatLong(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
