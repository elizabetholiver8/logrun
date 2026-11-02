import Link from "next/link";
import type { PlanDay, PlanView } from "../lib/plan-data";
import { formatDistance, unitLabel, type Units } from "../lib/units";

const KIND_LABEL: Record<PlanDay["kind"], string> = {
  easy: "Easy",
  long: "Long",
  tempo: "Tempo",
  intervals: "Intervals",
  rest: "Rest",
  lift: "Lift",
};

const KIND_STYLE: Record<PlanDay["kind"], string> = {
  easy: "bg-neutral-100 text-neutral-800",
  long: "bg-orange-100 text-orange-900 font-medium",
  tempo: "bg-slate-800 text-white",
  intervals: "bg-slate-800 text-white",
  rest: "text-neutral-400",
  lift: "bg-neutral-100 text-neutral-600",
};

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PlanCalendar({ view, units, today }: { view: PlanView; units: Units; today: string }) {
  const u = unitLabel(units);
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden grid-cols-[6rem_repeat(7,1fr)_5rem] gap-1 text-xs uppercase tracking-wide text-neutral-500 md:grid">
        <div>Week</div>
        {DOW.map((d) => <div key={d}>{d}</div>)}
        <div className="text-right">{u}</div>
      </div>
      {view.weeks.map((w) => {
        const past = w.days.every((d) => d.date < today);
        return (
          <div key={w.week} className="grid grid-cols-1 gap-1 rounded border border-neutral-200 p-2 md:grid-cols-[6rem_repeat(7,1fr)_5rem] md:border-0 md:p-0">
            <div className="text-sm text-neutral-600 md:py-2">
              {shortDate(w.week)}
            </div>
            {w.days.map((d) => <DayCell key={d.date} day={d} units={units} today={today} />)}
            <div className="text-right text-sm tabular-nums md:py-2">
              <span className={past && w.actualM < w.targetM * 0.8 ? "text-neutral-400" : ""}>
                {past || w.actualM > 0 ? `${formatDistance(w.actualM, units)} / ` : ""}
                {formatDistance(w.targetM, units)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayCell({ day, units, today }: { day: PlanDay; units: Units; today: string }) {
  const isToday = day.date === today;
  const isPast = day.date < today;
  const hasTarget = day.targetDistanceM !== null && day.targetDistanceM > 0;
  const lifts = day.kind === "lift" || day.notes?.includes("Lift");
  const title = [KIND_LABEL[day.kind], hasTarget ? `${formatDistance(day.targetDistanceM!, units)} ${unitLabel(units)}` : null, day.notes].filter(Boolean).join(". ");

  const body = (
    <div
      title={title}
      data-date={day.date}
      className={`flex min-h-14 flex-col justify-between rounded px-2 py-1 text-xs ${KIND_STYLE[day.kind]} ${isToday ? "ring-2 ring-orange-500" : ""} ${isPast && hasTarget && !day.completed ? "opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="md:hidden">{DOW[(new Date(`${day.date}T00:00:00`).getDay() + 6) % 7]} </span>
        <span>{KIND_LABEL[day.kind === "lift" ? "rest" : day.kind]}</span>
        {day.completed && <span aria-label="completed">✓</span>}
      </div>
      <div className="flex items-center justify-between tabular-nums">
        <span>{hasTarget ? formatDistance(day.targetDistanceM!, units) : ""}</span>
        {lifts && <span className="text-[10px] uppercase tracking-wide opacity-70">lift</span>}
      </div>
    </div>
  );
  return day.activityId ? <Link href={`/runs/${day.activityId}`}>{body}</Link> : body;
}

function shortDate(key: string): string {
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)}`;
}
