import Link from "next/link";
import type { PlanView } from "../lib/plan-data";
import { formatDistance, unitLabel, type Units } from "../lib/units";
import { KIND_LABEL } from "./plan-calendar";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Compact view of the current plan week for the dashboard. */
export function PlanStrip({ view, units, today }: { view: PlanView | null; units: Units; today: string }) {
  if (!view) {
    return (
      <section className="flex items-center justify-between rounded border border-dashed border-neutral-300 p-4 text-sm">
        <span className="text-neutral-600">No training plan yet.</span>
        <Link href="/plan/new" className="rounded border bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Build a plan</Link>
      </section>
    );
  }
  const week = view.weeks.find((w) => w.days[0].date <= today && w.days[6].date >= today);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-neutral-500">This week&apos;s plan</h2>
        <Link href="/plan" className="text-sm text-neutral-600 hover:underline">Full calendar</Link>
      </div>
      {week ? (
        <div className="grid grid-cols-7 gap-1">
          {week.days.map((d, i) => {
            const has = d.targetDistanceM !== null && d.targetDistanceM > 0;
            return (
              <div
                key={d.date}
                className={`rounded border px-2 py-1 text-xs ${d.date === today ? "border-orange-500" : "border-neutral-200"} ${d.date < today && has && !d.completed ? "opacity-50" : ""}`}
              >
                <div className="text-neutral-500">{DOW[i]}</div>
                <div className="font-medium">{KIND_LABEL[d.kind === "lift" ? "rest" : d.kind]}{d.completed ? " ✓" : ""}</div>
                <div className="tabular-nums text-neutral-600">
                  {has ? `${formatDistance(d.targetDistanceM!, units)} ${unitLabel(units)}` : ""}
                  {(d.kind === "lift" || d.notes?.includes("Lift")) && <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">lift</span>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-neutral-500">Plan is finished. <Link href="/plan/new" className="underline">Build a new one</Link>.</p>
      )}
    </section>
  );
}
