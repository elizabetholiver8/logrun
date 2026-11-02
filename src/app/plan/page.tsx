import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { PlanCalendar } from "../../components/plan-calendar";
import { db } from "../../db";
import { athletes } from "../../db/schema";
import { loadPlan } from "../../lib/plan-data";
import { getSession } from "../../lib/session";
import { formatDistance, localDateKey, unitLabel, unitsFromPreference } from "../../lib/units";
import { deletePlanAction } from "./actions";

const GOAL_LABEL = { "5k": "5K", "10k": "10K", half: "Half marathon", marathon: "Marathon" } as const;

export default function PlanPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6 md:p-8">
      <header className="flex items-baseline gap-4">
        <Link href="/" className="text-2xl font-semibold">logrun</Link>
        <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">Dashboard</Link>
      </header>
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

  const units = unitsFromPreference(athlete?.measurementPreference);
  const today = localDateKey(new Date());
  const peak = Math.max(...view.weeks.map((w) => w.targetM));
  const weeksLeft = view.weeks.filter((w) => w.days[6].date >= today).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{GOAL_LABEL[view.goal]} plan</h1>
          <p className="text-sm text-neutral-600">
            Race {formatLong(view.plan.raceDate)}. {view.weeks.length} weeks, {weeksLeft} to go. Peak week {formatDistance(peak, units)} {unitLabel(units)}.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/plan/new" className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100">Rebuild</Link>
          <form action={deletePlanAction}>
            <button type="submit" className="rounded border border-neutral-300 px-3 py-1 text-neutral-600 hover:bg-neutral-100">Delete plan</button>
          </form>
        </div>
      </div>
      <PlanCalendar view={view} units={units} today={today} />
      <p className="text-xs text-neutral-500">
        A check marks a day where your synced runs reached at least 80 percent of the target. Hover a day for details. Lifting is a slot, not a prescription.
      </p>
    </>
  );
}

function formatLong(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
