"use client";

import { useActionState } from "react";
import { applyCheckinAction, runCheckinAction, type CheckinActionState } from "../app/plan/checkin-actions";
import type { CheckinOutputJson } from "../db/schema";
import { describeAdjustment } from "../lib/checkin";

export type CheckinSummary = {
  id: number;
  weekStart: string;
  createdAt: string;
  appliedAt: string | null;
  model: string;
  output: CheckinOutputJson;
};

// const buttonClass = "rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50";
const quietButton = "rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50";

/**
 * The weekly check-in: latest review from the model, its one suggested
 * change with an Apply button, and the history. The model only ever picks
 * from a fixed menu; applying runs through the plan's own rules.
 */
export function CheckinPanel({ checkins, demo, configured }: { checkins: CheckinSummary[]; demo: boolean; configured: boolean }) {
  const [runState, runAction, running] = useActionState<CheckinActionState, FormData>(async () => runCheckinAction(), undefined);
  const [latest, ...history] = checkins;

  return (
    <section className="flex flex-col gap-4 rounded border border-neutral-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Weekly check-in</h2>
          <p className="text-sm text-neutral-600">
            A coach&apos;s read on last week against the plan, from Gemini, with one suggested change you can apply or ignore.
          </p>
        </div>
        <form action={runAction}>
          <button type="submit" className="rounded border bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50" disabled={running || demo || !configured} title={demo ? "Precomputed in the demo" : !configured ? "GEMINI_API_KEY is not set" : undefined}>
            {running ? "Thinking…" : latest ? "Run again" : "Run check-in"}
          </button>
        </form>
      </div>
      {runState?.error && <p className="text-sm text-red-700">{runState.error}</p>}
      {!configured && !demo && <p className="text-sm text-neutral-500">Set GEMINI_API_KEY to turn this on.</p>}

      {latest ? <CheckinView checkin={latest} demo={demo} /> : <p className="text-sm text-neutral-500">No check-in yet.</p>}

      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-600">Earlier check-ins ({history.length})</summary>
          <div className="mt-3 flex flex-col gap-4 border-l-2 border-neutral-200 pl-4">
            {history.map((c) => <CheckinView key={c.id} checkin={c} demo={demo} compact />)}
          </div>
        </details>
      )}
    </section>
  );
}

function CheckinView({ checkin, demo, compact = false }: { checkin: CheckinSummary; demo: boolean; compact?: boolean }) {
  const [state, action, pending] = useActionState<CheckinActionState, FormData>(applyCheckinAction, undefined);
  const a = checkin.output.adjustment;
  const applied = checkin.appliedAt !== null || state?.applied !== undefined;
  const when = new Date(checkin.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <article className="flex flex-col gap-2 text-sm">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Week of {checkin.weekStart.slice(5).replace("-", "/")} · {when} · {checkin.model}
      </div>
      <p className={compact ? "text-neutral-700" : "text-neutral-800"}>{checkin.output.summary}</p>
      {!compact && checkin.output.highlights.length > 0 && (
        <ul className="list-disc pl-5 text-neutral-700">
          {checkin.output.highlights.map((h) => <li key={h}>{h}</li>)}
        </ul>
      )}
      {!compact && checkin.output.concerns.length > 0 && (
        <ul className="list-disc pl-5 text-amber-800">
          {checkin.output.concerns.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded bg-neutral-50 px-3 py-2">
        <span>
          <strong>{describeAdjustment(a)}.</strong> <span className="text-neutral-600">{a.reason}</span>
        </span>
        {a.type !== "none" && (
          applied ? (
            <span className="text-xs text-emerald-700">Applied{state?.applied ? `, ${state.applied} day${state.applied === 1 ? "" : "s"} changed` : ""}</span>
          ) : (
            <form action={action} className="flex items-center gap-2">
              <input type="hidden" name="checkinId" value={checkin.id} />
              <button type="submit" className={quietButton} disabled={pending || demo} title={demo ? "Plan changes are off in the demo" : undefined}>
                {pending ? "Applying…" : "Apply to plan"}
              </button>
            </form>
          )
        )}
      </div>
      {state?.error && <p className="text-red-700">{state.error}</p>}
    </article>
  );
}
