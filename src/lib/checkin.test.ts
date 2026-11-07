import { describe, expect, it } from "vitest";
import { adjustmentUpdates, buildCheckinInput, checkinPrompt, describeAdjustment, parseCheckinResponse } from "./checkin";
import type { PlanDay, PlanView } from "./plan-data";

const MI = 1609.344;
const today = new Date(2026, 10, 4, 9); // Wed Nov 4 2026

function day(id: number, date: string, kind: PlanDay["kind"], miles: number | null, extra: Partial<PlanDay> = {}): PlanDay {
  return {
    id, date, kind, targetDistanceM: miles === null ? null : miles * MI, pace: kind === "rest" || kind === "lift" ? null : [320, 300], notes: null,
    completed: false, actualM: 0, activityId: null, actualRun: null, ...extra,
  };
}
function week(start: string, days: PlanDay[]): PlanView["weeks"][number] {
  return { week: start, days, targetM: days.reduce((a, d) => a + (d.targetDistanceM ?? 0), 0), actualM: days.reduce((a, d) => a + d.actualM, 0) };
}
const ran = (miles: number, minutes: number): Partial<PlanDay> => ({
  completed: true, actualM: miles * MI, activityId: 9, actualRun: { id: 9, name: "Morning Run", distanceM: miles * MI, movingTimeS: minutes * 60 },
});

const view: PlanView = {
  goal: "half",
  plan: {
    id: 3, athleteId: 1, goalDistanceM: 21097.5, raceDate: "2027-01-31", daysPerWeek: 5, liftDays: [1], runDays: [0, 2, 4, 5, 6], longRunDay: 0, qualityDay: null,
    hardDays: 1, goalTimeS: 6300, treadmill: false, createdAt: new Date(0), course: null,
    paceZones: { vdot: 45, easy: [360, 330], long: [360, 330], tempo: [300, 290], intervals: [270, 262], race: [298, 298] },
  },
  weeks: [
    week("2026-10-26", [
      day(1, "2026-10-26", "lift", null), day(2, "2026-10-27", "tempo", 5, ran(5.1, 42)), day(3, "2026-10-28", "easy", 3, ran(3, 29)),
      day(4, "2026-10-29", "easy", 3), day(5, "2026-10-30", "easy", 3), day(6, "2026-10-31", "rest", null), day(7, "2026-11-01", "long", 10, ran(10.2, 95)),
    ]),
    week("2026-11-02", [
      day(8, "2026-11-02", "lift", null), day(9, "2026-11-03", "intervals", 5), day(10, "2026-11-04", "easy", 3),
      day(11, "2026-11-05", "easy", 3), day(12, "2026-11-06", "easy", 3), day(13, "2026-11-07", "rest", null), day(14, "2026-11-08", "long", 11),
    ]),
    week("2026-11-09", [
      day(15, "2026-11-09", "lift", null), day(16, "2026-11-10", "tempo", 5), day(17, "2026-11-11", "easy", 3),
      day(18, "2026-11-12", "easy", 3), day(19, "2026-11-13", "easy", 3), day(20, "2026-11-14", "rest", null), day(21, "2026-11-15", "long", 11),
    ]),
  ],
};

describe("buildCheckinInput and checkinPrompt", () => {
  const input = buildCheckinInput(view, today, "miles");
  it("reviews the last full week and previews the current one", () => {
    expect(input.lastWeek.start).toBe("2026-10-26");
    expect(input.upcoming.nextWeekStart).toBe("2026-11-09");
    expect(input.upcoming.days[0].date).toBe("2026-11-05");
    expect(input.upcoming.days).toHaveLength(11);
    expect(input.lastWeek.planned).toBe(24);
    expect(input.lastWeek.actual).toBeCloseTo(18.3, 1);
    expect(input.lastWeek.completedDays).toBe(3);
    expect(input.lastWeek.plannedDays).toBe(5);
    expect(input.weeksToRace).toBe(13);
    expect(input.goalTime).toBe("1:45:00");
  });
  it("writes days the model can read, with paces per mile", () => {
    const tue = input.lastWeek.days[1];
    expect(tue.planned).toMatch(/^tempo 5.0 mi at 8:03 to 8:35 \/mi/);
    expect(tue.actual).toBe("5.1 mi at 8:14 /mi");
    expect(input.lastWeek.days[5].planned).toBe("rest");
  });
  it("puts the numbers and the menu in the prompt", () => {
    const p = checkinPrompt(input);
    expect(p).toContain("planned 24, ran 18.3; 3 of 5 planned runs completed");
    expect(p).toContain("scale_volume");
    expect(p).toContain("Do not invent runs");
  });
});

describe("parseCheckinResponse", () => {
  const base = { summary: "A solid week with the long run done and two easy days missed.", highlights: ["Long run done"], concerns: [] };
  it("accepts a well formed answer and clamps numbers", () => {
    const r = parseCheckinResponse(JSON.stringify({ ...base, adjustment: { type: "scale_volume", percent: -40, weeks: 3, reason: "Missed days" } }), view, today);
    expect(r.ok && r.output.adjustment).toEqual({ type: "scale_volume", percent: -25, weeks: 1, reason: "Missed days" });
  });
  it("rejects junk, empty summaries and zero changes", () => {
    expect(parseCheckinResponse("not json", view, today).ok).toBe(false);
    expect(parseCheckinResponse(JSON.stringify({ ...base, summary: "", adjustment: { type: "none", reason: "x" } }), view, today).ok).toBe(false);
    expect(parseCheckinResponse(JSON.stringify({ ...base, adjustment: { type: "adjust_paces", percent: 0, reason: "x" } }), view, today).ok).toBe(false);
  });
  it("only allows swaps on upcoming non-long days inside the plan", () => {
    const ok = parseCheckinResponse(JSON.stringify({ ...base, adjustment: { type: "swap_workout", date: "2026-11-10", kind: "easy", reason: "Rest more" } }), view, today);
    expect(ok.ok && ok.output.adjustment.type).toBe("swap_workout");
    const past = parseCheckinResponse(JSON.stringify({ ...base, adjustment: { type: "swap_workout", date: "2026-11-03", kind: "easy", reason: "x" } }), view, today);
    expect(past.ok).toBe(false);
    const long = parseCheckinResponse(JSON.stringify({ ...base, adjustment: { type: "swap_workout", date: "2026-11-08", kind: "easy", reason: "x" } }), view, today);
    expect(long.ok).toBe(false);
    const missing = parseCheckinResponse(JSON.stringify({ ...base, adjustment: { type: "swap_workout", date: "2027-06-01", kind: "easy", reason: "x" } }), view, today);
    expect(missing.ok).toBe(false);
  });
  it("refuses a pace change on a plan with no goal time", () => {
    const noZones = { ...view, plan: { ...view.plan, paceZones: null } };
    const r = parseCheckinResponse(JSON.stringify({ ...base, adjustment: { type: "adjust_paces", percent: 3, reason: "x" } }), noZones, today);
    expect(r.ok).toBe(false);
  });
  it("falls back to none for an unknown type", () => {
    const r = parseCheckinResponse(JSON.stringify({ ...base, adjustment: { type: "retire", reason: "x" } }), view, today);
    expect(r.ok && r.output.adjustment.type).toBe("none");
  });
});

describe("adjustmentUpdates", () => {
  it("scales next week's distances only, never race day, rounded to 100 m", () => {
    const { updates } = adjustmentUpdates({ type: "scale_volume", percent: -20, weeks: 1, reason: "" }, view, today);
    expect(updates.map((u) => u.id)).toEqual([16, 17, 18, 19, 21]);
    expect(updates[0].targetDistanceM).toBe(6400); // 5 mi = 8047 m, times 0.8 = 6437, rounded
  });
  it("shifts future paces and the zones together", () => {
    const { updates, zones } = adjustmentUpdates({ type: "adjust_paces", percent: 2, reason: "" }, view, today);
    expect(updates.every((u) => u.id > 10)).toBe(true);
    expect(updates[0].paceMinSPerKm).toBeCloseTo(326.4);
    expect(zones?.tempo[0]).toBeCloseTo(306);
  });
  it("swaps one workout, keeping its distance and lift note", () => {
    const { updates } = adjustmentUpdates({ type: "swap_workout", date: "2026-11-10", kind: "easy", reason: "" }, view, today);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: 16, kind: "easy", targetDistanceM: 5 * MI, paceMinSPerKm: 360, paceMaxSPerKm: 330 });
    const rest = adjustmentUpdates({ type: "swap_workout", date: "2026-11-09", kind: "rest", reason: "" }, { ...view }, today);
    expect(rest.updates[0]).toMatchObject({ id: 15, kind: "lift", targetDistanceM: null });
  });
  it("returns nothing for none", () => {
    expect(adjustmentUpdates({ type: "none", reason: "" }, view, today).updates).toEqual([]);
  });
});

describe("describeAdjustment", () => {
  it("reads naturally", () => {
    expect(describeAdjustment({ type: "scale_volume", percent: -15, weeks: 2, reason: "" })).toBe("Cut next two weeks' distances by 15 percent");
    expect(describeAdjustment({ type: "adjust_paces", percent: 3, reason: "" })).toBe("Make every target pace 3 percent slower");
    expect(describeAdjustment({ type: "swap_workout", date: "2026-11-10", kind: "easy", reason: "" })).toBe("Make Tuesday, Nov 10 easy run");
    expect(describeAdjustment({ type: "none", reason: "" })).toBe("No change");
  });
});
