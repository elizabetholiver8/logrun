import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DemoBanner } from "../../../components/demo-banner";
import { DemoPlanExplainer } from "../../../components/demo-plan-explainer";
import { PlanForm } from "../../../components/plan-form";
import { loadBaseline } from "../../../lib/plan-data";
import { getSession, isDemoSession } from "../../../lib/session";
import { formatDistance, localDateKey, unitLabel, unitsFromPreference } from "../../../lib/units";
import { db } from "../../../db";
import { athletes } from "../../../db/schema";
import { eq } from "drizzle-orm";

export default function NewPlanPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6 md:p-8">
      <header className="flex items-baseline gap-4">
        <Link href="/" className="text-2xl font-semibold">logrun</Link>
        <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">Dashboard</Link>
      </header>
      <h1 className="text-xl font-semibold">New training plan</h1>
      <Suspense fallback={<p className="text-neutral-400">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const session = await getSession();
  if (!session) redirect("/");
  const today = new Date();
  const [baseline, athlete] = await Promise.all([
    loadBaseline(session.athleteId, today),
    db.query.athletes.findFirst({ where: eq(athletes.id, session.athleteId) }),
  ]);
  const units = unitsFromPreference(athlete?.measurementPreference);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const demo = isDemoSession(session);

  return (
    <div className="flex flex-col gap-6">
      {demo && <DemoBanner />}
      <p className="max-w-md text-sm text-neutral-600">
        Your starting point comes from synced runs: averaging{" "}
        <strong>{formatDistance(baseline.weeklyM, units)} {unitLabel(units)}</strong> per week over the last four
        full weeks, longest run <strong>{formatDistance(baseline.longestM, units)} {unitLabel(units)}</strong>.
        {baseline.weeksOfData < 4 && " Fewer than four weeks of data were found, so the plan will start conservatively."}
      </p>
      {demo && <DemoPlanExplainer />}
      <PlanForm minDate={localDateKey(tomorrow)} today={localDateKey(today)} units={units} demo={demo} />
    </div>
  );
}
