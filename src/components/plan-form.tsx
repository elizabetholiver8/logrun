"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { createPlanAction, type PlanFormState } from "../app/plan/actions";
import { WEEKDAY_NAMES, adjacentWeekdays, chooseRunDays, defaultQualityDay, secondQualityDay, type Weekday } from "../lib/plan";
import { formatDistance, unitLabel, type Units } from "../lib/units";
import { CourseProfileChart } from "./course-profile-chart";
import { PaceZonesTable } from "./pace-zones-table";
import { PlanCalendarView } from "./plan-calendar-view";

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
 * Plan inputs. The athlete says which weekdays are free; the generator
 * decides how many to use each week from the volume. The quality session
 * is auto-placed with an override that warns, live, when it lands next to
 * the long run. Server validation in lib/plan-form.ts is the source of
 * truth; the client state here only keeps the choices consistent as the
 * user clicks.
 *
 * Every field is controlled and the form is submitted by hand: a form
 * submitted through its `action` prop is reset by React once the action
 * settles, which would wipe the inputs behind a preview. The download
 * buttons are the exception: they post the same fields natively to the
 * export route, which answers with a file.
 */
export function PlanForm({ minDate, today, units, demo = false }: { minDate: string; today: string; units: Units; demo?: boolean }) {
  const [state, action, pending] = useActionState<PlanFormState, FormData>(createPlanAction, undefined);
  const [goal, setGoal] = useState("half");
  const [raceDate, setRaceDate] = useState("");
  const [goalTime, setGoalTime] = useState("");
  const [available, setAvailable] = useState<Weekday[]>(chooseRunDays(5, DEFAULT_LONG_RUN));
  const [longRunDay, setLongRunDay] = useState<Weekday>(DEFAULT_LONG_RUN);
  const [qualityDay, setQualityDay] = useState<Weekday | "">("");
  const [twoHard, setTwoHard] = useState(false);
  const [liftDays, setLiftDays] = useState<Weekday[]>([]);
  const [treadmill, setTreadmill] = useState(false);
  const [gpxName, setGpxName] = useState("");

  const autoQuality = defaultQualityDay(available, longRunDay);
  const effectiveQuality = qualityDay === "" ? autoQuality : qualityDay;
  const qualityAdjacent = qualityDay !== "" && adjacentWeekdays(qualityDay, longRunDay);
  const tooFew = available.length < 3;
  const canTwoHard = available.length >= 6;
  const secondHard = canTwoHard && twoHard ? secondQualityDay(available, longRunDay, effectiveQuality) : null;

  function toggleAvailable(day: Weekday, checked: boolean) {
    const next = checked ? [...available, day].sort((a, b) => a - b) : available.filter((d) => d !== day);
    setAvailable(next);
    // Keep the dependent picks valid: an unchecked day cannot host anything.
    if (!checked && day === longRunDay && next.length > 0) setLongRunDay(next[0]);
    if (!checked && day === qualityDay) setQualityDay("");
    if (next.length < 6) setTwoHard(false);
  }

  function changeLongRun(day: Weekday) {
    setLongRunDay(day);
    if (qualityDay === day) setQualityDay("");
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    // Download buttons carry their own formAction; let the browser post
    // them natively so the response can be saved as a file.
    if (submitter?.formAction && submitter.getAttribute("formaction")) return;
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  }

  const preview = state?.preview;

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={submit} encType="multipart/form-data" method="post" className="flex max-w-xl flex-col gap-5">
        <fieldset disabled={pending} className="contents">
          <div className="grid gap-5 sm:grid-cols-2">
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

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Goal time, optional</span>
              <input
                type="text"
                name="goalTime"
                inputMode="numeric"
                placeholder="1:45:00"
                value={goalTime}
                onChange={(e) => setGoalTime(e.target.value)}
                className={inputClass}
              />
              <span className="text-xs text-neutral-500">Sets a target pace range on every run.</span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Race course GPX, optional</span>
              <input
                type="file"
                name="gpx"
                accept=".gpx,application/gpx+xml"
                onChange={(e) => setGpxName(e.target.files?.[0]?.name ?? "")}
                className="text-sm file:mr-3 file:rounded file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm"
              />
              <span className="text-xs text-neutral-500">{gpxName ? `${gpxName} selected.` : "Adds hill sessions sized to the course."}</span>
            </label>
          </div>

          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="font-medium">Days you can run, 3 to 7</legend>
            <div className="flex flex-wrap gap-3">
              {ALL_DAYS.map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="checkbox" name="availableDays" value={d} checked={available.includes(d)} onChange={(e) => toggleAvailable(d, e.target.checked)} />
                  {WEEKDAY_NAMES[d].slice(0, 3)}
                </label>
              ))}
            </div>
            <p className="text-xs text-neutral-500">
              {tooFew ? "Pick at least three days." : "The plan uses as many of these as the week's mileage needs, spread out, and adds days as you build."}
            </p>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Long run day</span>
              <select name="longRunDay" value={longRunDay} onChange={(e) => changeLongRun(Number(e.target.value) as Weekday)} className={inputClass}>
                {available.map((d) => (
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
                {available.filter((d) => d !== longRunDay).map((d) => (
                  <option key={d} value={d}>{WEEKDAY_NAMES[d]}</option>
                ))}
              </select>
              {qualityAdjacent && (
                <span className="text-xs text-amber-700">
                  {WEEKDAY_NAMES[effectiveQuality]} is right next to your {WEEKDAY_NAMES[longRunDay]} long run. The plan will keep it, but an easy day between hard efforts is the usual advice.
                </span>
              )}
            </label>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <label className={`flex items-center gap-2 ${canTwoHard ? "" : "text-neutral-400"}`}>
              <input type="checkbox" name="hardDays" value="2" checked={twoHard} disabled={!canTwoHard} onChange={(e) => setTwoHard(e.target.checked)} />
              Two hard days a week
            </label>
            <input type="hidden" name="hardDays" value="1" disabled={twoHard} />
            <span className="text-xs text-neutral-500">
              {!canTwoHard
                ? "Needs six or seven available days so hard efforts stay apart."
                : twoHard && secondHard !== null
                  ? `Tempo on ${WEEKDAY_NAMES[effectiveQuality]}, intervals or hills on ${WEEKDAY_NAMES[secondHard]}, in weeks with five or more runs.`
                  : twoHard
                    ? "No second day fits with room beside the long run and quality day; the plan will keep one hard day."
                    : "For experienced runners: a tempo and an interval or hill session in the same week."}
            </span>
          </div>

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

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="treadmill" checked={treadmill} onChange={(e) => setTreadmill(e.target.checked)} />
            I have a treadmill
            <span className="text-xs text-neutral-500">Hill sessions become incline workouts with the grade set.</span>
          </label>

          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending || tooFew}
              className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {pending ? "Building plan…" : demo ? "Preview plan" : "Build plan"}
            </button>
            {preview && (
              <>
                <button type="submit" formAction="/plan/export?format=ics" formMethod="post" className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
                  Download calendar
                </button>
                <button type="submit" formAction="/plan/export?format=csv" formMethod="post" className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
                  Download CSV
                </button>
              </>
            )}
          </div>
        </fieldset>
      </form>

      {preview && (
        <section id="preview" className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">Preview: {GOALS.find((g) => g.value === preview.view.goal)?.label} plan</h2>
            <p className="text-sm text-neutral-600">
              {preview.view.weeks.length} weeks to race day. Peak week{" "}
              {formatDistance(Math.max(...preview.view.weeks.map((w) => w.targetM)), units)} {unitLabel(units)}. Not saved; change the inputs and preview again, or download it.
            </p>
          </div>
          {preview.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              {preview.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          {preview.view.plan.paceZones && preview.view.plan.goalTimeS && (
            <PaceZonesTable zones={preview.view.plan.paceZones} goalTimeS={preview.view.plan.goalTimeS} units={units} />
          )}
          {preview.view.plan.course && <CourseProfileChart course={preview.view.plan.course} units={units} />}
          <PlanCalendarView view={preview.view} units={units} today={today} />
        </section>
      )}
    </div>
  );
}
