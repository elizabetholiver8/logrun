import { describe, expect, it } from "vitest";
import type { PlanView } from "./plan-data";
import { formatPaceRange, planToCsv, planToIcs } from "./plan-export";

const MI = 1609.344;
const view: PlanView = {
  goal: "half",
  plan: {
    id: 7, athleteId: 1, goalDistanceM: 21097.5, raceDate: "2027-01-31", daysPerWeek: 5, liftDays: [1], runDays: [0, 2, 4, 5, 6],
    longRunDay: 0, qualityDay: null, hardDays: 1, goalTimeS: 6300, treadmill: false, paceZones: null, course: null, createdAt: new Date(0),
  },
  weeks: [
    {
      week: "2026-11-02", targetM: 20 * MI, actualM: 5 * MI,
      days: [
        { id: 1, date: "2026-11-02", kind: "lift", targetDistanceM: null, pace: null, notes: "Lift", completed: false, actualM: 0, activityId: null, actualRun: null },
        { id: 2, date: "2026-11-03", kind: "tempo", targetDistanceM: 5 * MI, pace: [300, 290], notes: 'Warm up, then "hard", cool down', completed: true, actualM: 5 * MI, activityId: 55, actualRun: { id: 55, name: "Tempo, felt good", distanceM: 5 * MI, movingTimeS: 2400 } },
        { id: 3, date: "2026-11-04", kind: "rest", targetDistanceM: null, pace: null, notes: null, completed: false, actualM: 0, activityId: null, actualRun: null },
      ],
    },
  ],
};

describe("formatPaceRange", () => {
  it("converts to per-mile and orders fast to slow", () => {
    expect(formatPaceRange([300, 290], "miles")).toBe("7:47 to 8:03 /mi");
    expect(formatPaceRange([300, 300], "km")).toBe("5:00 /km");
    expect(formatPaceRange(null, "miles")).toBe("");
  });
});

describe("planToCsv", () => {
  const csv = planToCsv(view, "miles");
  const lines = csv.trim().split("\r\n");
  it("has a header and one row per day", () => {
    expect(lines[0]).toBe("date,weekday,workout,target_mi,pace_fast,pace_slow,notes,completed,actual_mi,actual_pace,actual_run");
    expect(lines).toHaveLength(4);
  });
  it("quotes fields with commas and quotes, and fills actuals", () => {
    expect(lines[2]).toBe('2026-11-03,Tue,Tempo,5.00,7:47,8:03,"Warm up, then ""hard"", cool down",yes,5.00,8:00,"Tempo, felt good"');
    expect(lines[1]).toBe("2026-11-02,Mon,Lift,,,,Lift,,,,");
  });
});

describe("planToIcs", () => {
  const ics = planToIcs(view, "miles", new Date("2026-11-06T12:00:00Z"));
  it("emits one all-day event per non-rest day with stable ids", () => {
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(ics).toContain("UID:logrun-plan-7-2026-11-03@logrun");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261103");
    expect(ics).toContain("DTEND;VALUE=DATE:20261104");
    expect(ics).toContain("SUMMARY:Tempo 5.00 mi");
    expect(ics).toContain("SUMMARY:Lift");
    expect(ics).toContain("DTSTAMP:20261106T120000Z");
  });
  it("escapes commas in descriptions and uses CRLF line endings", () => {
    expect(ics).toContain("DESCRIPTION:Warm up\\, then \"hard\"\\, cool down\\nPace 7:47 to 8:03 /mi");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
