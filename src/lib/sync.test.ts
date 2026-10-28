import { describe, expect, it } from "vitest";
import { nearRateLimit, pageBounds, toActivityRow, type StravaSummaryActivity } from "./sync";

const base: StravaSummaryActivity = {
  id: 123,
  name: "Morning Run",
  sport_type: "Run",
  distance: 8046.7,
  moving_time: 2400,
  elapsed_time: 2460,
  total_elevation_gain: 42.5,
  start_date: "2026-10-20T11:30:00Z",
  start_date_local: "2026-10-20T07:30:00Z",
  timezone: "(GMT-05:00) America/New_York",
  average_speed: 3.35,
  max_speed: 4.1,
  map: { summary_polyline: "abc" },
};

describe("toActivityRow", () => {
  it("maps Strava fields to column names and units unchanged", () => {
    const row = toActivityRow(base, 42);
    expect(row.id).toBe(123);
    expect(row.athleteId).toBe(42);
    expect(row.distanceM).toBeCloseTo(8046.7);
    expect(row.movingTimeS).toBe(2400);
    expect(row.summaryPolyline).toBe("abc");
    expect(row.startDate.toISOString()).toBe("2026-10-20T11:30:00.000Z");
  });

  it("stores local start time as wall-clock, not shifted to UTC", () => {
    const row = toActivityRow(base, 42);
    expect(row.startDateLocal.getHours()).toBe(7);
    expect(row.startDateLocal.getMinutes()).toBe(30);
  });

  it("tolerates missing optional fields", () => {
    const row = toActivityRow({ ...base, map: null, average_heartrate: undefined, total_elevation_gain: undefined }, 42);
    expect(row.summaryPolyline).toBeNull();
    expect(row.averageHeartrate).toBeNull();
    expect(row.totalElevationGainM).toBeNull();
  });
});

describe("nearRateLimit", () => {
  it("is false with no header data", () => {
    expect(nearRateLimit(null)).toBe(false);
  });
  it("is false with plenty of room", () => {
    expect(nearRateLimit({ shortUsage: 50, shortLimit: 200, dailyUsage: 100, dailyLimit: 2000 })).toBe(false);
  });
  it("is true when the 15-minute window is nearly spent", () => {
    expect(nearRateLimit({ shortUsage: 195, shortLimit: 200, dailyUsage: 100, dailyLimit: 2000 })).toBe(true);
  });
  it("is true when the daily budget is nearly spent", () => {
    expect(nearRateLimit({ shortUsage: 10, shortLimit: 200, dailyUsage: 1995, dailyLimit: 2000 })).toBe(true);
  });
});

describe("pageBounds", () => {
  it("returns null for an empty page", () => {
    expect(pageBounds([])).toBeNull();
  });
  it("finds oldest and newest regardless of order", () => {
    const b = pageBounds([
      { ...base, start_date: "2026-10-18T10:00:00Z" },
      { ...base, start_date: "2026-10-22T10:00:00Z" },
      { ...base, start_date: "2026-10-20T10:00:00Z" },
    ])!;
    expect(b.oldest.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(b.newest.toISOString()).toBe("2026-10-22T10:00:00.000Z");
  });
});
