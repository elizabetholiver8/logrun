import { describe, expect, it } from "vitest";
import { runName, toLocalWallClock, transformExport, type ExportedRun } from "./demo";

const row = (s: string, extra: Partial<ExportedRun> = {}): ExportedRun => ({ d: 8000, t: 2400, e: 2500, g: 30, s, p: "", h: 150, ...extra });

describe("transformExport", () => {
  const today = new Date(Date.UTC(2026, 10, 2, 20, 0, 0)); // Mon Nov 2 2026, evening UTC
  const rows = [
    row("2025-03-10T12:30:00.000Z", { p: "abc" }),
    row("2025-03-08T22:15:00.000Z"),
    row("2025-03-01T11:00:00.000Z", { p: "xyz" }),
    row("2025-02-20T11:00:00.000Z", { p: "old" }),
  ];
  const out = transformExport(rows, today, { keepPolylines: 2, timeZone: "America/New_York" });

  it("sorts by start and numbers ids from 1", () => {
    expect(out.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(out[0].startDate.getTime()).toBeLessThan(out[3].startDate.getTime());
  });
  it("shifts every run by whole days so the newest lands on today with its time of day intact", () => {
    const newest = out[3].startDate;
    expect(newest.toISOString()).toBe("2026-11-02T12:30:00.000Z");
    // The gap between runs is preserved exactly.
    expect(out[3].startDate.getTime() - out[2].startDate.getTime()).toBe(
      new Date(rows[0].s).getTime() - new Date(rows[1].s).getTime(),
    );
  });
  it("keeps polylines only on the most recent N that have one", () => {
    expect(out.map((r) => r.summaryPolyline)).toEqual([null, "xyz", null, "abc"]);
  });
  it("uses generic names and derives speed", () => {
    expect(out.every((r) => /Run$/.test(r.name))).toBe(true);
    expect(out[0].averageSpeedMps).toBeCloseTo(8000 / 2400);
  });
  it("lands the newest run on today's local date even when seeding late in the evening", () => {
    const lateEvening = new Date("2026-11-03T02:30:00Z"); // 9:30 pm Nov 2 in New York
    const r = transformExport(rows, lateEvening, { keepPolylines: 0, timeZone: "America/New_York" });
    expect(r[3].startDateLocal.getDate()).toBe(2);
    expect(r[3].startDateLocal.getMonth()).toBe(10);
  });
  it("drops rows with no distance or time", () => {
    expect(transformExport([row("2025-01-01T00:00:00Z", { d: 0 })], today, { keepPolylines: 0, timeZone: "UTC" })).toEqual([]);
  });
});

describe("toLocalWallClock", () => {
  it("renders a UTC instant as the wall clock in the zone, DST aware", () => {
    const summer = toLocalWallClock(new Date("2026-07-01T12:00:00Z"), "America/New_York");
    expect(summer.getHours()).toBe(8);
    const winter = toLocalWallClock(new Date("2026-01-01T12:00:00Z"), "America/New_York");
    expect(winter.getHours()).toBe(7);
  });
});

describe("runName", () => {
  it("names by hour, with long runs by distance", () => {
    expect(runName(6, 8000)).toBe("Morning Run");
    expect(runName(12, 8000)).toBe("Lunch Run");
    expect(runName(15, 8000)).toBe("Afternoon Run");
    expect(runName(19, 8000)).toBe("Evening Run");
    expect(runName(7, 30000)).toBe("Long Run");
  });
});
