"use client";

import { useActionState } from "react";
import { createPlanAction, type PlanFormState } from "../app/plan/actions";
import { WEEKDAY_NAMES } from "../lib/plan";

const GOALS = [
  { value: "5k", label: "5K" },
  { value: "10k", label: "10K" },
  { value: "half", label: "Half marathon" },
  { value: "marathon", label: "Marathon" },
];

export function PlanForm({ minDate }: { minDate: string }) {
  const [state, action, pending] = useActionState<PlanFormState, FormData>(createPlanAction, undefined);

  return (
    <form action={action} className="flex max-w-md flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Goal race</span>
        <select name="goal" defaultValue="half" className="rounded border border-neutral-300 px-3 py-2">
          {GOALS.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Race date</span>
        <input type="date" name="raceDate" required min={minDate} className="rounded border border-neutral-300 px-3 py-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Running days per week</span>
        <select name="daysPerWeek" defaultValue="4" className="rounded border border-neutral-300 px-3 py-2">
          {[3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Long run day</span>
        <select name="longRunDay" defaultValue="0" className="rounded border border-neutral-300 px-3 py-2">
          {WEEKDAY_NAMES.map((n, i) => (
            <option key={n} value={i}>{n}</option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="font-medium">Lifting days, up to three</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAY_NAMES.map((n, i) => (
            <label key={n} className="flex items-center gap-1">
              <input type="checkbox" name="liftDays" value={i} />
              {n.slice(0, 3)}
            </label>
          ))}
        </div>
      </fieldset>

      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {pending ? "Building plan…" : "Build plan"}
      </button>
    </form>
  );
}
