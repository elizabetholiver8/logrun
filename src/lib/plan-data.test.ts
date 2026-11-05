import { describe, expect, it } from "vitest";
import { buildWeeks } from "./plan-data";

const MI = 1609.344;
const day = (id: number, date: string, kind: "easy" | "long" | "rest", miles: number | null) => ({
  id, date, kind, targetDistanceM: miles === null ? null : miles * MI, notes: null,
});

describe("buildWeeks", () => {
  const workouts = [
    day(1, "2026-11-02", "easy", 5), day(2, "2026-11-03", "rest", null), day(3, "2026-11-04", "easy", 5),
    day(4, "2026-11-05", "rest", null), day(5, "2026-11-06", "easy", 5), day(6, "2026-11-07", "rest", null),
    day(7, "2026-11-08", "long", 10),
    day(8, "2026-11-09", "easy", 5),
  ];
  const runs = [
    { id: 100, distanceM: 5.1 * MI, startDateLocal: new Date(2026, 10, 2, 7) },
    { id: 101, distanceM: 3 * MI, startDateLocal: new Date(2026, 10, 4, 7) },
    { id: 102, distanceM: 6 * MI, startDateLocal: new Date(2026, 10, 8, 8) },
    { id: 103, distanceM: 4 * MI, startDateLocal: new Date(2026, 10, 8, 16) },
  ];
  const weeks = buildWeeks(workouts, runs);

  it("chunks by seven days, a trailing partial week included", () => {
    expect(weeks).toHaveLength(2);
    expect(weeks[0].week).toBe("2026-11-02");
    expect(weeks[1].days).toHaveLength(1);
  });
  it("marks completion per day and sums same-day runs", () => {
    const done = weeks[0].days.filter((d) => d.completed).map((d) => d.date);
    expect(done).toEqual(["2026-11-02", "2026-11-08"]);
    expect(weeks[0].days[6].actualM / MI).toBeCloseTo(10);
    expect(weeks[0].days[6].activityId).toBe(102);
  });
  it("totals target and actual per week", () => {
    expect(weeks[0].targetM / MI).toBeCloseTo(25);
    expect(weeks[0].actualM / MI).toBeCloseTo(18.1);
  });
});
