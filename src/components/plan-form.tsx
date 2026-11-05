"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { createPlanAction, type PlanFormState } from "../app/plan/actions";
import { WEEKDAY_NAMES, adjacentWeekdays, chooseRunDays, defaultQualityDay, type Weekday } from "../lib/plan";
import { formatDistance, unitLabel, type Units } from "../lib/units";
import { PlanCalendar } from "./plan-calendar";

const GOALS = [
  { value: "5k", label: "5K" },
  { value: "10k", label: "10K" },
  { value: "half", label: "Half marathon" },
  { value: "marathon", label: "Marathon" },
];

const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_LONG_RUN: Weekday = 0;

const inputClass = "rounded border border-neutral-300 px-3 py-2 disabled:bg-neutral-100 disabled:text-neutral-500";

/**
 * Plan inputs. The athlete picks which weekdays to run and which of those
 * carries the long run. The quality session is auto-placed, with an override
 * that warns, live, when it lands next to the long run. Server validation in
 * actions.ts is the source of truth; the client state here only keeps the
 * choices consistent as the user clicks. In the demo the action returns a
 * preview instead of redirecting, and it is rendered under the form.
 */
export function PlanForm({ minDate, today, units, demo = false }: { minDate: string; today: string; units: Units; demo?: boolean }) {
  const [state, action, pending] = useActionState<PlanFormState, FormData>(createPlanAction, undefined);
  // Every field is controlled and the form is submitted by hand below:
  // a form submitted through its `action` prop is reset by React once the
  // action settles, which would wipe the inputs behind a preview and leave
  // the DOM disagreeing with this state.
  const [goal, setGoal] = useState("half");
  const [raceDate, setRaceDate] = useState("");
  const [liftDays, setLiftDays] = useState<Weekday[]>([]);
  const [runDays, setRunDays] = useState<Weekday[]>(chooseRunDays(4, DEFAULT_LONG_RUN));
  const [longRunDay, setLongRunDay] = useState<Weekday>(DEFAULT_LONG_RUN);
  const [qualityDay, setQualityDay] = useState<Weekday | "">("");

  const autoQuality = defaultQualityDay(runDays, longRunDay);
  const effectiveQuality = qualityDay === "" ? autoQuality : qualityDay;
  const qualityAdjacent = qualityDay !== "" && adjacentWeekdays(qualityDay, longRunDay);
  const tooFew = runDays.length < 3;
  const tooMany = runDays.length > 6;

  function toggleRunDay(day: Weekday, checked: boolean) {
    const next = checked ? [...runDays, day].sort((a, b) => a - b) : runDays.filter((d) => d !== day);
    setRunDays(next);
    // Keep the dependent picks valid: an unchecked day cannot host anything.
    if (!checked && day === longRunDay && next.length > 0) setLongRunDay(next[0]);
    if (!checked && day === qualityDay) setQualityDay("");
  }

  function changeLongRun(day: Weekday) {
    setLongRunDay(day);
    if (qualityDay === day) setQualityDay("");
  }

  const preview = state?.preview;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <div className="flex flex-col gap-8">
    <form onSubmit={submit} className="flex max-w-md flex-col gap-5">
      <fieldset disabled={pending} className="contents">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Goal race</span>
          <select name="goal" value={goal} onChange={(e) => setGoal(e.target.value)} className={inputClass}>
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Race date</span>
          <input type="date" name="raceDate" required min={minDate} value={raceDate} onChange={(e) => setRaceDate(e.target.value)} className={inputClass} />
        </label>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium">Running days, 3 to 6</legend>
          <div className="flex flex-wrap gap-3">
            {ALL_DAYS.map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="runDays"
                  value={d}
                  checked={runDays.includes(d)}
                  onChange={(e) => toggleRunDay(d, e.target.checked)}
                />
                {WEEKDAY_NAMES[d].slice(0, 3)}
              </label>
            ))}
          </div>
          {(tooFew || tooMany) && (
            <p className="text-xs text-amber-700">{tooFew ? "Pick at least three days." : "Pick at most six days."}</p>
          )}
        </fieldset>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Long run day</span>
          <select name="longRunDay" value={longRunDay} onChange={(e) => changeLongRun(Number(e.target.value) as Weekday)} className={inputClass}>
            {runDays.map((d) => (
              <option key={d} value={d}>{WEEKDAY_NAMES[d]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Quality day, tempo or intervals</span>
          <select
            name="qualityDay"
            value={qualityDay}
            onChange={(e) => setQualityDay(e.target.value === "" ? "" : (Number(e.target.value) as Weekday))}
            className={inputClass}
          >
            <option value="">Let the plan choose ({WEEKDAY_NAMES[autoQuality]})</option>
            {runDays.filter((d) => d !== longRunDay).map((d) => (
              <option key={d} value={d}>{WEEKDAY_NAMES[d]}</option>
            ))}
          </select>
          {qualityAdjacent && (
            <span className="text-xs text-amber-700">
              {WEEKDAY_NAMES[effectiveQuality]} is right next to your {WEEKDAY_NAMES[longRunDay]} long run. The plan will keep it, but an easy day between hard efforts is the usual advice.
            </span>
          )}
        </label>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium">Lifting days, up to three</legend>
          <div className="flex flex-wrap gap-3">
            {ALL_DAYS.map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="liftDays"
                  value={d}
                  checked={liftDays.includes(d)}
                  onChange={(e) => setLiftDays(e.target.checked ? [...liftDays, d].sort((a, b) => a - b) : liftDays.filter((x) => x !== d))}
                />
                {WEEKDAY_NAMES[d].slice(0, 3)}
              </label>
            ))}
          </div>
          <p className="text-xs text-neutral-500">A lift on the day before the long run gets moved automatically.</p>
        </fieldset>

        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}

        <button
          type="submit"
          disabled={pending || tooFew || tooMany}
          className="w-fit rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {pending ? "Building plan…" : demo ? "Preview plan" : "Build plan"}
        </button>
      </fieldset>
    </form>

    {preview && (
      <section id="preview" className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Preview: {GOALS.find((g) => g.value === preview.view.goal)?.label} plan</h2>
          <p className="text-sm text-neutral-600">
            {preview.view.weeks.length} weeks to race day. Peak week{" "}
            {formatDistance(Math.max(...preview.view.weeks.map((w) => w.targetM)), units)} {unitLabel(units)}. Not saved; change the inputs and preview again.
          </p>
        </div>
        {preview.warnings.length > 0 && (
          <ul className="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {preview.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        <PlanCalendar view={preview.view} units={units} today={today} />
      </section>
    )}
    </div>
  );
}
