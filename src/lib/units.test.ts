import { describe, expect, it } from "vitest";
import {
  bucketByWeek, formatDistance, formatDuration, formatPace, localDateKey,
  paceSecondsPer, unitsFromPreference, weekStart,
} from "./units";

describe("units", () => {
  it("maps Strava preference to units, defaulting to miles", () => {
    expect(unitsFromPreference("feet")).toBe("miles");
    expect(unitsFromPreference("meters")).toBe("km");
    expect(unitsFromPreference(null)).toBe("miles");
  });
  it("formats distance in both systems", () => {
    expect(formatDistance(8046.72, "miles")).toBe("5.00");
    expect(formatDistance(10000, "km")).toBe("10.0");
    expect(formatDistance(42195, "km")).toBe("42.2");
    expect(formatDistance(170000, "miles")).toBe("106");
  });
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(2527)).toBe("42:07");
    expect(formatDuration(3755)).toBe("1:02:35");
  });
  it("computes and formats pace", () => {
    expect(formatPace(paceSecondsPer(8046.72, 2610, "miles"))).toBe("8:42");
    expect(formatPace(paceSecondsPer(10000, 3000, "km"))).toBe("5:00");
    expect(paceSecondsPer(0, 100, "miles")).toBeNull();
    expect(formatPace(null)).toBe("–");
  });
});

describe("weekStart", () => {
  it("returns the Monday of the week, same wall-clock day for Monday", () => {
    expect(localDateKey(weekStart(new Date(2026, 9, 28, 7, 30)))).toBe("2026-10-26"); // Wed -> Mon
    expect(localDateKey(weekStart(new Date(2026, 9, 26, 0, 1)))).toBe("2026-10-26"); // Mon
    expect(localDateKey(weekStart(new Date(2026, 10, 1, 23, 59)))).toBe("2026-10-26"); // Sun late -> same week
  });
  it("does not shift across a year boundary incorrectly", () => {
    expect(localDateKey(weekStart(new Date(2026, 0, 1)))).toBe("2025-12-29"); // Thu Jan 1 -> Mon Dec 29
  });
});

describe("bucketByWeek", () => {
  const today = new Date(2026, 10, 2); // Mon Nov 2 2026
  it("returns the requested number of weeks ending with the current one, zero-filled", () => {
    const b = bucketByWeek([], 4, today);
    expect(b.map((w) => w.week)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
    expect(b.every((w) => w.runs === 0 && w.distanceM === 0)).toBe(true);
  });
  it("sums runs into the right week and ignores runs outside the window", () => {
    const b = bucketByWeek(
      [
        { startDateLocal: new Date(2026, 9, 28, 6), distanceM: 5000, movingTimeS: 1500 },
        { startDateLocal: new Date(2026, 10, 1, 23, 30), distanceM: 10000, movingTimeS: 3000 }, // Sun night, same week
        { startDateLocal: new Date(2026, 10, 2, 7), distanceM: 3000, movingTimeS: 900 }, // this week
        { startDateLocal: new Date(2026, 8, 1), distanceM: 99999, movingTimeS: 1 }, // too old
      ],
      4,
      today,
    );
    expect(b[2]).toEqual({ week: "2026-10-26", runs: 2, distanceM: 15000, movingTimeS: 4500 });
    expect(b[3]).toEqual({ week: "2026-11-02", runs: 1, distanceM: 3000, movingTimeS: 900 });
    expect(b[0].runs + b[1].runs).toBe(0);
  });
});
