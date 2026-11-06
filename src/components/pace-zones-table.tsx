import type { PaceZonesJson } from "../db/schema";
import { formatPaceRange } from "../lib/plan-export";
import { formatGoalTime } from "../lib/pace";
import type { Units } from "../lib/units";

/** Goal time and the training paces derived from it. */
export function PaceZonesTable({ zones, goalTimeS, units }: { zones: PaceZonesJson; goalTimeS: number; units: Units }) {
  const rows: [string, [number, number]][] = [
    ["Easy and long", zones.easy],
    ["Tempo", zones.tempo],
    ["Intervals", zones.intervals],
    ["Race", zones.race],
  ];
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
      <span className="text-neutral-600">
        Goal <strong className="text-neutral-900">{formatGoalTime(goalTimeS)}</strong>
      </span>
      {rows.map(([label, range]) => (
        <span key={label} className="text-neutral-600">
          {label} <strong className="tabular-nums text-neutral-900">{formatPaceRange(range, units)}</strong>
        </span>
      ))}
    </div>
  );
}
