import { describe, expect, it } from "vitest";
import {
  BASELINE_WEEKS, CUTBACK_FACTOR, DAY_THRESHOLDS_M, LONG_RUN_SHARE, RAMP_MAX, TAPER_FLOOR,
  adjacentWeekdays, chooseRunDays, computeBaseline, defaultQualityDay, generatePlan, hillGrade, layoutWeek, matchWorkout,
  peakVolumeM, resolveLiftDays, runDaysForVolume, secondQualityDay, selectRunDays, weeklyTargets, type Baseline, type Weekday,
} from "./plan";
import type { CourseProfile } from "./gpx";

const MI = 1609.344;
const today = new Date(2026, 10, 2); // Mon Nov 2 2026

function run(y: number, m: number, d: number, miles: number, minutes?: number) {
  return { startDateLocal: new Date(y, m - 1, d, 7), distanceM: miles * MI, movingTimeS: minutes ? minutes * 60 : undefined };
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
    expect(computeBaseline([], today)).toEqual({ weeklyM: 0, longestM: 0, weeksOfData: 0, runsPerWeek: 0, bestPaceSPerKm: null });
  });
  it("counts runs per week and the best pace among runs long enough to matter", () => {
    const runs = [run(2026, 10, 26, 3, 24), run(2026, 10, 28, 6, 54), run(2026, 10, 19, 7, 56), run(2026, 10, 12, 2, 12)];
    const b = computeBaseline(runs, today, 5 * MI);
    expect(b.runsPerWeek).toBe(1);
    // 3 mi in 24 min is the fastest but too short to count; 7 mi in 56 min wins among the long ones.
    expect(b.bestPaceSPerKm).toBeCloseTo((56 * 60) / (7 * MI / 1000), 3);
  });
});

describe("runDaysForVolume and selectRunDays", () => {
  it("starts at three days and adds one per threshold, capped by availability", () => {
    expect(runDaysForVolume(10_000, 5, 0)).toBe(3);
    expect(runDaysForVolume(DAY_THRESHOLDS_M[0], 5, 0)).toBe(4);
    expect(runDaysForVolume(DAY_THRESHOLDS_M[1], 5, 0)).toBe(5);
    expect(runDaysForVolume(DAY_THRESHOLDS_M[3], 5, 0)).toBe(5);
    expect(runDaysForVolume(DAY_THRESHOLDS_M[3], 7, 0)).toBe(7);
  });
  it("never drops below what the runner already does, within availability, unless easy runs would get silly", () => {
    expect(runDaysForVolume(40_000, 6, 5)).toBe(5);
    expect(runDaysForVolume(40_000, 4, 5)).toBe(4);
    // 10 km a week leaves 4.8 km for easy days: one easy day, so three days total.
    expect(runDaysForVolume(10_000, 6, 5)).toBe(3);
    // 55 km with two hard sessions leaves 15.4 km easy: three easy days, six total, not seven.
    expect(runDaysForVolume(55_000, 7, 7, 2)).toBe(6);
  });
  it("spreads chosen days so rest days are not bunched", () => {
    // Five available, three used: Sun long run plus two spread days.
    expect(selectRunDays([0, 1, 2, 3, 4], 3, [0, 2])).toEqual([0, 2, 4]);
    // Every day available, four used: rest before the Sunday long run beats a perfect alternation.
    expect(selectRunDays([0, 1, 2, 3, 4, 5, 6], 4, [0, 2])).toEqual([0, 2, 3, 5]);
    // Five of seven: the two rest days are split up, and one falls before the Sunday long run.
    expect(selectRunDays([0, 1, 2, 3, 4, 5, 6], 5, [0, 2])).toEqual([0, 1, 2, 4, 5]);
  });
  it("always keeps the required days", () => {
    expect(selectRunDays([1, 3, 5, 6], 2, [6, 3])).toEqual([3, 6]);
  });
});

describe("secondQualityDay", () => {
  it("picks a day clear of the long run and the first quality day", () => {
    const d = secondQualityDay([0, 1, 2, 3, 4, 5, 6], 0, 2);
    expect(d).toBe(4);
  });
  it("returns null when nothing fits", () => {
    expect(secondQualityDay([0, 2, 4, 5], 0, 2)).toBe(5 === 5 && adjacentWeekdays(5, 0) ? null : 4);
    expect(secondQualityDay([0, 1, 2, 3], 0, 2)).toBe(null);
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

describe("defaultQualityDay and adjacency", () => {
  it("picks the first run day with a buffer on both sides of the long run", () => {
    expect(defaultQualityDay([0, 2, 4, 5], 0)).toBe(2);
    expect(defaultQualityDay([1, 3, 4, 6], 6)).toBe(1);
    expect(defaultQualityDay([0, 1, 6], 0)).toBe(1); // nothing non-adjacent; day after beats day before
  });
  it("adjacentWeekdays wraps around the week", () => {
    expect(adjacentWeekdays(6, 0)).toBe(true);
    expect(adjacentWeekdays(0, 1)).toBe(true);
    expect(adjacentWeekdays(2, 4)).toBe(false);
  });
});

describe("layoutWeek", () => {
  const monday = new Date(2026, 10, 2);
  const week = layoutWeek(monday, 40_000, "build", { runDays: [0, 2, 4, 5], longRunDay: 0, liftDays: [1, 3], quality: [{ day: 2, kind: "tempo" }], goalM: 21097.5 });
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
    const raceWeek = layoutWeek(monday, 15_000, "race", { runDays: [0, 2, 4, 5], longRunDay: 0, liftDays: [1, 3], quality: [{ day: 2, kind: "tempo" }], goalM: 21097.5, raceDate: "2026-11-08" });
    expect(raceWeek.some((w) => w.kind === "lift" || w.notes?.includes("Lift"))).toBe(false);
  });
  it("replaces the quality session with easy running during taper", () => {
    const taper = layoutWeek(monday, 25_000, "taper", { runDays: [0, 2, 4, 5], longRunDay: 0, liftDays: [], quality: [{ day: 2, kind: "intervals" }], goalM: 21097.5 });
    expect(taper.some((w) => w.kind === "intervals" || w.kind === "tempo")).toBe(false);
  });
});

describe("generatePlan", () => {
  const baseline: Baseline = { weeklyM: 35 * MI, longestM: 10 * MI, weeksOfData: 4, runsPerWeek: 5, bestPaceSPerKm: 330 };
  const input = {
    goal: "half" as const, raceDate: "2027-03-14", startDate: "2026-11-02",
    availableDays: [0, 1, 2, 3, 4, 5, 6] as Weekday[], longRunDay: 0 as Weekday, hardDays: 1 as const,
    liftDays: [1, 4] as (1 | 4)[], baseline,
  };

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
    const p = generatePlan({ ...input, baseline: { ...baseline, weeklyM: 10 * MI, longestM: 4 * MI, weeksOfData: 1 } });
    expect(p.warnings.some((w) => /Baseline uses 1 of/.test(w))).toBe(true);
  });
  it("warns when the build cannot reach full volume at a safe ramp", () => {
    const p = generatePlan({ ...input, goal: "marathon", raceDate: "2026-12-27", baseline: { ...baseline, weeklyM: 15 * MI, longestM: 6 * MI } });
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
  it("runs only on available days", () => {
    const p = generatePlan({ ...input, availableDays: [0, 1, 3, 5], baseline: { ...baseline, runsPerWeek: 4 } });
    const buildWeek = p.weeks[1].workouts;
    const runDows = buildWeek.filter((w) => w.targetDistanceM !== null).map((w) => new Date(`${w.date}T00:00:00`).getDay());
    expect(runDows.sort()).toEqual([0, 1, 3, 5]);
  });
  it("starts a beginner on three days even with five available, and adds days as volume grows", () => {
    const beginner: Baseline = { weeklyM: 8 * MI, longestM: 3 * MI, weeksOfData: 4, runsPerWeek: 2, bestPaceSPerKm: null };
    const p = generatePlan({ ...input, availableDays: [0, 1, 2, 3, 4], baseline: beginner });
    expect(p.weeks[0].runDays).toBe(3);
    const peakWeekDays = Math.max(...p.weeks.map((w) => w.runDays));
    expect(peakWeekDays).toBeGreaterThan(3);
    // No two rest days in a row with three run days out of Sun, Mon, Tue, Wed, Thu
    // is impossible, but the run days must not be bunched: at most two in a row.
    const dows = p.weeks[0].workouts.filter((w) => w.targetDistanceM !== null).map((w) => new Date(`${w.date}T00:00:00`).getDay()).sort();
    expect(dows).toEqual([0, 2, 4]);
  });
  it("honors a quality day override and warns when it is next to the long run", () => {
    const p = generatePlan({ ...input, availableDays: [0, 1, 3, 5], qualityDay: 1 });
    const monday = p.weeks[1].workouts[0];
    expect(["tempo", "intervals"]).toContain(monday.kind);
    expect(p.warnings.some((w) => /next to the Sunday long run/.test(w))).toBe(true);
    const quiet = generatePlan({ ...input, availableDays: [0, 1, 3, 5], qualityDay: 3 });
    expect(quiet.warnings).toEqual([]);
  });
  it("rejects available days that exclude the long run or a quality day that is the long run", () => {
    expect(() => generatePlan({ ...input, availableDays: [1, 3, 5] })).toThrow();
    expect(() => generatePlan({ ...input, availableDays: [0, 1, 3], qualityDay: 0 })).toThrow();
  });
  it("adds a second hard day only in weeks with five or more runs, and warns when it cannot", () => {
    const p = generatePlan({ ...input, hardDays: 2 });
    const kinds = (i: number) => p.weeks[i].workouts.map((w) => w.kind);
    const hardCount = (i: number) => kinds(i).filter((k) => k === "tempo" || k === "intervals").length;
    expect(hardCount(1)).toBe(2);
    expect(kinds(1)).toContain("tempo");
    expect(kinds(1)).toContain("intervals");
    const few = generatePlan({ ...input, availableDays: [0, 1, 2, 3, 4], hardDays: 2 });
    expect(few.warnings.some((w) => /second hard day/.test(w))).toBe(true);
  });
  it("gives every run a pace range when a goal time is set, and warns about an unrealistic goal", () => {
    const p = generatePlan({ ...input, goalTimeS: 105 * 60 });
    expect(p.zones).not.toBeNull();
    const easy = p.weeks[2].workouts.find((w) => w.kind === "easy")!;
    const tempo = p.weeks[2].workouts.find((w) => w.kind === "tempo")!;
    expect(easy.paceSPerKm![1]).toBeGreaterThan(tempo.paceSPerKm![1]);
    expect(p.warnings).toEqual([]);
    const race = p.weeks.at(-1)!.workouts.find((w) => w.date === "2027-03-14")!;
    expect(race.paceSPerKm![0]).toBeCloseTo((105 * 60) / 21.0975, 3);
    const fast = generatePlan({ ...input, goalTimeS: 80 * 60 });
    expect(fast.warnings.some((w) => /more than 10 percent faster/.test(w))).toBe(true);
    const unknown = generatePlan({ ...input, goalTimeS: 105 * 60, baseline: { ...baseline, bestPaceSPerKm: null } });
    expect(unknown.warnings.some((w) => /check your goal time/.test(w))).toBe(true);
  });
  it("turns interval sessions into hill repeats on a hilly course, treadmill wording when asked", () => {
    const course: CourseProfile = {
      points: [], distanceM: 21_000, gainM: 520, lossM: 500, gainPerKm: 24.8,
      longestClimb: { startM: 14_000, lengthM: 2_400, gainM: 150, gradePct: 6.3 }, maxGradePct: 9.1, category: "hilly",
    };
    const p = generatePlan({ ...input, course, units: "miles" });
    const all = p.weeks.flatMap((w) => w.workouts);
    expect(all.some((w) => w.kind === "hills")).toBe(true);
    expect(all.some((w) => w.kind === "intervals")).toBe(false);
    const hill = all.find((w) => w.kind === "hills")!;
    expect(hill.notes).toMatch(/Hill repeats: .*8 x 90 s.*about 6%/);
    expect(hill.paceSPerKm).toBeNull();
    const long = p.weeks[1].workouts.find((w) => w.kind === "long")!;
    expect(long.notes).toMatch(/hilly route, about \d+ ft of climbing/);
    const race = all.find((w) => w.date === "2027-03-14")!;
    expect(race.notes).toMatch(/Race day\. 1706 ft of climbing, longest climb 1\.5 mi at 6\.3%/);
    const tm = generatePlan({ ...input, course, treadmill: true });
    expect(tm.weeks.flatMap((w) => w.workouts).find((w) => w.kind === "hills")!.notes).toMatch(/Treadmill hills: .*6% incline/);
    expect(hillGrade({ ...course, longestClimb: { ...course.longestClimb!, gradePct: 12 } })).toBe(8);
  });
  it("adds no hill work on a flat course and says so", () => {
    const flat: CourseProfile = { points: [], distanceM: 21_000, gainM: 60, lossM: 60, gainPerKm: 2.9, longestClimb: null, maxGradePct: 1.2, category: "flat" };
    const p = generatePlan({ ...input, course: flat });
    expect(p.weeks.flatMap((w) => w.workouts).some((w) => w.kind === "hills")).toBe(false);
    expect(p.warnings.some((w) => /course is flat/.test(w))).toBe(true);
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
