import { describe, expect, it } from "vitest";
import {
  BASELINE_WEEKS, CUTBACK_FACTOR, LONG_RUN_SHARE, RAMP_MAX, TAPER_FLOOR,
  chooseRunDays, computeBaseline, generatePlan, layoutWeek, matchWorkout,
  peakVolumeM, resolveLiftDays, weeklyTargets, type Baseline,
} from "./plan";

const MI = 1609.344;
const today = new Date(2026, 10, 2); // Mon Nov 2 2026

function run(y: number, m: number, d: number, miles: number) {
  return { startDateLocal: new Date(y, m - 1, d, 7), distanceM: miles * MI };
}

describe("computeBaseline", () => {
  it("averages the last four complete weeks and excludes the current partial week", () => {
    const runs = [
      run(2026, 11, 2, 20), // today, current week: excluded
      run(2026, 10, 26, 10), run(2026, 10, 28, 10), // week of 10/26: 20
      run(2026, 10, 19, 15), run(2026, 10, 24, 5), // week of 10/19: 20
      run(2026, 10, 12, 20), // week of 10/12: 20
      run(2026, 10, 5, 20), // week of 10/5: 20
      run(2026, 9, 28, 99), // five weeks ago: excluded
    ];
    const b = computeBaseline(runs, today);
    expect(b.weeklyM / MI).toBeCloseTo(20, 5);
    expect(b.longestM / MI).toBeCloseTo(20, 5);
    expect(b.weeksOfData).toBe(4);
  });
  it("divides by the full window when weeks are missing, and reports the count", () => {
    const b = computeBaseline([run(2026, 10, 27, 40), run(2026, 10, 14, 40)], today);
    expect(b.weeklyM / MI).toBeCloseTo(20, 5);
    expect(b.weeksOfData).toBe(2);
  });
  it("returns zeros with no data", () => {
    expect(computeBaseline([], today)).toEqual({ weeklyM: 0, longestM: 0, weeksOfData: 0 });
  });
});

describe("weeklyTargets", () => {
  const peak = peakVolumeM("half");
  it("never ramps more than RAMP_MAX week over week during the build", () => {
    const t = weeklyTargets(30_000, peak, 14, "half");
    for (let i = 1; i < t.length; i++) {
      if (t[i].phase === "build" && t[i - 1].phase === "build") {
        expect(t[i].targetM / t[i - 1].targetM).toBeLessThanOrEqual(1 + RAMP_MAX + 0.005);
      }
    }
  });
  it("never exceeds the peak", () => {
    const t = weeklyTargets(60_000, peak, 20, "half");
    expect(Math.max(...t.map((w) => w.targetM))).toBeLessThanOrEqual(peak + 50);
  });
  it("places a cutback every fourth week during the build at CUTBACK_FACTOR of the prior week", () => {
    const t = weeklyTargets(40_000, peak, 14, "half");
    expect(t[3].phase).toBe("cutback");
    expect(t[7].phase).toBe("cutback");
    expect(t[3].targetM / t[2].targetM).toBeCloseTo(CUTBACK_FACTOR, 1);
  });
  it("resumes the ramp from the pre-cutback volume, not the cutback volume", () => {
    const t = weeklyTargets(40_000, peak, 14, "half");
    expect(t[4].targetM).toBeGreaterThan(t[2].targetM);
  });
  it("tapers for two weeks on a half and one on a 5k, ending in race week", () => {
    const half = weeklyTargets(40_000, peak, 12, "half");
    expect(half.slice(-3).map((w) => w.phase)).toEqual(["taper", "taper", "race"]);
    const fivek = weeklyTargets(20_000, peakVolumeM("5k"), 8, "5k");
    expect(fivek.slice(-2).map((w) => w.phase)).toEqual(["taper", "race"]);
  });
  it("taper descends toward TAPER_FLOOR of the last build week", () => {
    const t = weeklyTargets(40_000, peak, 12, "half");
    const lastBuild = t[8].targetM;
    expect(t[9].targetM).toBeLessThan(lastBuild);
    expect(t[10].targetM).toBeLessThan(t[9].targetM);
    expect(t[10].targetM / lastBuild).toBeGreaterThanOrEqual(TAPER_FLOOR - 0.02);
  });
  it("starts a zero-baseline runner at a floor rather than zero", () => {
    const t = weeklyTargets(0, peak, 10, "half");
    expect(t[0].targetM).toBeGreaterThan(0);
  });
});

describe("chooseRunDays and lifts", () => {
  it("always includes the long run day and spreads the rest", () => {
    expect(chooseRunDays(3, 0)).toEqual([0, 2, 4]);
    expect(chooseRunDays(4, 6)).toEqual([1, 3, 4, 6]);
    expect(chooseRunDays(6, 0)).toHaveLength(6);
  });
  it("moves a lift off the day before the long run and says so", () => {
    const r = resolveLiftDays([1, 6], 0); // Saturday lift before Sunday long run
    expect(r.liftDays).not.toContain(6);
    expect(r.liftDays).toHaveLength(2);
    expect(r.warning).toMatch(/moved off Saturday/);
  });
  it("prefers a non-quality day for the relocated lift", () => {
    const r = resolveLiftDays([1, 6], 0, [2]); // Tuesday is the quality day
    expect(r.liftDays).not.toContain(2);
    expect(r.liftDays).toHaveLength(2);
  });
  it("leaves non-conflicting lifts alone", () => {
    expect(resolveLiftDays([1, 3], 0)).toEqual({ liftDays: [1, 3], warning: null });
  });
});

describe("layoutWeek", () => {
  const monday = new Date(2026, 10, 2);
  const week = layoutWeek(monday, 40_000, "build", { daysPerWeek: 4, longRunDay: 0, liftDays: [1, 3], qualityKind: "tempo", goalM: 21097.5 });
  it("returns seven days, Monday first", () => {
    expect(week).toHaveLength(7);
    expect(week[0].date).toBe("2026-11-02");
    expect(week[6].date).toBe("2026-11-08");
  });
  it("has one long run on the long run day at about LONG_RUN_SHARE of volume", () => {
    const longs = week.filter((w) => w.kind === "long");
    expect(longs).toHaveLength(1);
    expect(longs[0].date).toBe("2026-11-08");
    expect(longs[0].targetDistanceM! / 40_000).toBeCloseTo(LONG_RUN_SHARE, 1);
  });
  it("has exactly one quality session, never the day before the long run", () => {
    const q = week.filter((w) => w.kind === "tempo" || w.kind === "intervals");
    expect(q).toHaveLength(1);
    expect(q[0].date).not.toBe("2026-11-07");
  });
  it("daily targets sum to roughly the weekly target", () => {
    const sum = week.reduce((a, w) => a + (w.targetDistanceM ?? 0), 0);
    expect(Math.abs(sum - 40_000) / 40_000).toBeLessThan(0.05);
  });
  it("marks lift days, as a lift on rest days and as a note on run days", () => {
    const mon = week[0]; const wed = week[2];
    expect([mon, wed].some((w) => w.kind === "lift" || w.notes?.includes("Lift"))).toBe(true);
    expect(week.filter((w) => w.notes?.includes("Lift") || w.kind === "lift")).toHaveLength(2);
  });
  it("schedules no lifts in race week", () => {
    const raceWeek = layoutWeek(monday, 15_000, "race", { daysPerWeek: 4, longRunDay: 0, liftDays: [1, 3], qualityKind: "tempo", goalM: 21097.5, raceDate: "2026-11-08" });
    expect(raceWeek.some((w) => w.kind === "lift" || w.notes?.includes("Lift"))).toBe(false);
  });
  it("replaces the quality session with easy running during taper", () => {
    const taper = layoutWeek(monday, 25_000, "taper", { daysPerWeek: 4, longRunDay: 0, liftDays: [], qualityKind: "intervals", goalM: 21097.5 });
    expect(taper.some((w) => w.kind === "intervals" || w.kind === "tempo")).toBe(false);
  });
});

describe("generatePlan", () => {
  const baseline: Baseline = { weeklyM: 35 * MI, longestM: 10 * MI, weeksOfData: 4 };
  const input = { goal: "half" as const, raceDate: "2027-03-14", startDate: "2026-11-02", daysPerWeek: 5 as const, liftDays: [1, 4] as (1 | 4)[], baseline };

  it("covers every day from the start week through race week and ends on race day", () => {
    const p = generatePlan(input);
    expect(p.weeks[0].workouts[0].date).toBe("2026-11-02");
    const last = p.weeks.at(-1)!;
    expect(last.phase).toBe("race");
    const raceDay = last.workouts.find((w) => w.date === "2027-03-14")!;
    expect(raceDay.notes).toBe("Race day");
    expect(raceDay.targetDistanceM).toBeCloseTo(21097.5);
    expect(last.workouts.filter((w) => w.date > "2027-03-14").every((w) => w.kind === "rest")).toBe(true);
  });
  it("produces no warnings for a well-timed plan with full data", () => {
    expect(generatePlan(input).warnings).toEqual([]);
  });
  it("warns when the race is too close", () => {
    const p = generatePlan({ ...input, raceDate: "2026-11-22" });
    expect(p.warnings.some((w) => /compressed/.test(w))).toBe(true);
  });
  it("warns when baseline data is thin", () => {
    const p = generatePlan({ ...input, baseline: { weeklyM: 10 * MI, longestM: 4 * MI, weeksOfData: 1 } });
    expect(p.warnings.some((w) => /Baseline uses 1 of/.test(w))).toBe(true);
  });
  it("warns when the build cannot reach full volume at a safe ramp", () => {
    const p = generatePlan({ ...input, goal: "marathon", raceDate: "2026-12-27", baseline: { weeklyM: 15 * MI, longestM: 6 * MI, weeksOfData: 4 } });
    expect(p.warnings.some((w) => /more build week/.test(w))).toBe(true);
  });
  it("does not prescribe days before the start date", () => {
    const p = generatePlan({ ...input, startDate: "2026-11-04" }); // Wednesday
    const first = p.weeks[0].workouts;
    expect(first.slice(0, 2).every((w) => w.kind === "rest" && w.targetDistanceM === null)).toBe(true);
  });
  it("rejects a race date that is not after the start", () => {
    expect(() => generatePlan({ ...input, raceDate: "2026-11-02" })).toThrow();
  });
});

describe("matchWorkout", () => {
  const w = { targetDistanceM: 11_265, kind: "easy" as const }; // 7 mi
  it("counts a single run within tolerance", () => {
    expect(matchWorkout(w, [{ id: 1, distanceM: 6.2 * MI }]).completed).toBe(true);
  });
  it("sums same-day runs so a paused watch still counts, and links the longest", () => {
    const r = matchWorkout(w, [{ id: 1, distanceM: 7.55 * MI }, { id: 2, distanceM: 0.79 * MI }]);
    expect(r.completed).toBe(true);
    expect(r.activityId).toBe(1);
  });
  it("fails below tolerance and on rest days", () => {
    expect(matchWorkout(w, [{ id: 1, distanceM: 4 * MI }]).completed).toBe(false);
    expect(matchWorkout({ targetDistanceM: null, kind: "rest" }, [{ id: 1, distanceM: 10 * MI }]).completed).toBe(false);
  });
  it("accepts overshooting", () => {
    expect(matchWorkout(w, [{ id: 1, distanceM: 12 * MI }]).completed).toBe(true);
  });
});

describe("constants sanity", () => {
  it("baseline window is four weeks", () => expect(BASELINE_WEEKS).toBe(4));
});
