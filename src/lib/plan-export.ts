import type { PlanDay, PlanView } from "./plan-data";
import { formatDistance, formatPace, metersToDistance, paceSecondsPer, unitLabel, type Units } from "./units";

/**
 * Plan downloads. Both formats are small enough to write by hand, which
 * keeps the dependency list short and the output under our control.
 */

const KIND_LABEL: Record<PlanDay["kind"], string> = {
  easy: "Easy run",
  long: "Long run",
  tempo: "Tempo",
  intervals: "Intervals",
  hills: "Hills",
  rest: "Rest",
  lift: "Lift",
};

const GOAL_LABEL = { "5k": "5K", "10k": "10K", half: "Half marathon", marathon: "Marathon" } as const;

/** "8:10 to 8:45 /mi" from a seconds-per-km range. */
export function formatPaceRange(pace: [number, number] | null, units: Units): string {
  if (!pace) return "";
  const per = units === "miles" ? 1.609344 : 1;
  const slow = formatPace(pace[0] * per);
  const fast = formatPace(pace[1] * per);
  return slow === fast ? `${slow} /${unitLabel(units)}` : `${fast} to ${slow} /${unitLabel(units)}`;
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function planToCsv(view: PlanView, units: Units): string {
  const u = unitLabel(units);
  const header = ["date", "weekday", "workout", `target_${u}`, "pace_fast", "pace_slow", "notes", "completed", `actual_${u}`, "actual_pace", "actual_run"];
  const rows: string[][] = [header];
  for (const w of view.weeks) {
    for (const d of w.days) {
      const per = units === "miles" ? 1.609344 : 1;
      const actualPace = d.actualRun ? paceSecondsPer(d.actualRun.distanceM, d.actualRun.movingTimeS, units) : null;
      rows.push([
        d.date,
        new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }),
        KIND_LABEL[d.kind] + (d.kind !== "lift" && d.notes?.includes("Lift") ? " + lift" : ""),
        d.targetDistanceM ? metersToDistance(d.targetDistanceM, units).toFixed(2) : "",
        d.pace ? formatPace(d.pace[1] * per) : "",
        d.pace ? formatPace(d.pace[0] * per) : "",
        d.notes ?? "",
        d.completed ? "yes" : d.targetDistanceM ? "no" : "",
        d.actualM ? metersToDistance(d.actualM, units).toFixed(2) : "",
        actualPace ? formatPace(actualPace) : "",
        d.actualRun?.name ?? "",
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Fold lines at 75 octets as RFC 5545 requires. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = " " + rest.slice(73);
  }
  out.push(rest);
  return out.join("\r\n");
}

function icsDate(key: string): string {
  return key.replace(/-/g, "");
}

function nextDay(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One all-day event per non-rest day. All-day events have no time zone,
 * which is what a training calendar wants: the run is on that date
 * wherever the athlete wakes up.
 */
export function planToIcs(view: PlanView, units: Units, stamp = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//logrun//training plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:logrun ${GOAL_LABEL[view.goal]} plan`,
  ];
  for (const w of view.weeks) {
    for (const d of w.days) {
      const lifts = d.kind === "lift" || Boolean(d.notes?.includes("Lift"));
      if (d.kind === "rest" && !lifts) continue;
      const dist = d.targetDistanceM ? ` ${formatDistance(d.targetDistanceM, units)} ${unitLabel(units)}` : "";
      const summary = d.kind === "lift" ? "Lift" : `${KIND_LABEL[d.kind]}${dist}${lifts ? " + lift" : ""}`;
      const desc = [d.notes, d.pace ? `Pace ${formatPaceRange(d.pace, units)}` : null].filter(Boolean).join("\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:logrun-plan-${view.plan.id}-${d.date}@logrun`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${icsDate(d.date)}`,
        `DTEND;VALUE=DATE:${icsDate(nextDay(d.date))}`,
        `SUMMARY:${icsEscape(summary)}`,
      );
      if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
      lines.push("END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
