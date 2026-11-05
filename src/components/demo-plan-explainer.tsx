import { BASELINE_WEEKS, CUTBACK_EVERY, CUTBACK_FACTOR, LONG_RUN_SHARE, MATCH_TOLERANCE, RAMP_MAX } from "../lib/plan";

const pct = (x: number) => `${Math.round(x * 100)} percent`;

/**
 * Shown above the plan form in the demo only. Reads its numbers from the
 * generator's constants so the text cannot drift from the code.
 */
export function DemoPlanExplainer() {
  return (
    <aside className="flex max-w-2xl flex-col gap-3 rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
      <div>
        <h2 className="mb-1 font-medium text-neutral-900">How the plan is built</h2>
        <p>
          The generator is a rules engine, not a template. It starts from this runner&apos;s average over the last {BASELINE_WEEKS} complete
          weeks and ramps weekly volume by at most {pct(RAMP_MAX)} toward a peak set by the goal distance. Every {ordinal(CUTBACK_EVERY)} week
          is a cutback to {pct(CUTBACK_FACTOR)} of the week before, and the last weeks before the race taper down. Each week gets one long run
          at about {pct(LONG_RUN_SHARE)} of the volume on your chosen day, one quality session kept off the days beside it unless you override
          that, easy runs on the rest of your days, and lifting slots that are moved off the day before the long run. Each day is then checked
          against synced runs and counts as done at {pct(1 - MATCH_TOLERANCE)} of target.
        </p>
      </div>
      <div>
        <h2 className="mb-1 font-medium text-neutral-900">Why your plan will not be saved</h2>
        <p>
          Everyone who opens the demo shares this one athlete. If previews were saved, each visitor would overwrite the seeded plan and each
          other. So the form below runs the real generator against the real history and shows you the result, then discards it. Connect your
          own Strava account to build a plan that persists and tracks your runs.
        </p>
      </div>
    </aside>
  );
}

function ordinal(n: number): string {
  return n === 4 ? "fourth" : `${n}th`;
}
