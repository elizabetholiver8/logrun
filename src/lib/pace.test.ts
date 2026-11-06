import { describe, expect, it } from "vitest";
import { formatGoalTime, paceAtFraction, paceZones, parseGoalTime, vdotFromRace } from "./pace";

describe("vdotFromRace", () => {
  it("matches Daniels' published table within a point", () => {
    // Daniels: a 20:00 5K is VDOT 49.8; a 1:30:00 half is about 51.
    expect(vdotFromRace(5000, 20 * 60)).toBeCloseTo(49.8, 0);
    expect(vdotFromRace(21097.5, 90 * 60)).toBeCloseTo(51, 0);
  });
  it("rejects non-positive inputs", () => {
    expect(() => vdotFromRace(0, 100)).toThrow();
  });
});

describe("paceZones", () => {
  const z = paceZones(21097.5, 105 * 60); // 1:45 half, 4:58/km
  it("orders the zones from easy to fast and brackets race pace between tempo and easy", () => {
    expect(z.easy[0]).toBeGreaterThan(z.easy[1]);
    expect(z.easy[1]).toBeGreaterThan(z.race[0]);
    expect(z.race[0]).toBeGreaterThan(z.tempo[0] - 15);
    expect(z.tempo[1]).toBeGreaterThan(z.intervals[0]);
    expect(z.race[0]).toBeCloseTo((105 * 60) / 21.0975, 3);
  });
  it("gives an easy pace roughly a minute per km slower than race pace for a half", () => {
    const diff = (z.easy[0] + z.easy[1]) / 2 - z.race[0];
    expect(diff).toBeGreaterThan(40);
    expect(diff).toBeLessThan(100);
  });
  it("is monotonic in the fraction", () => {
    expect(paceAtFraction(50, 0.7)).toBeGreaterThan(paceAtFraction(50, 0.9));
  });
});

describe("parseGoalTime and formatGoalTime", () => {
  it("reads h:mm:ss, mm:ss and bare minutes", () => {
    expect(parseGoalTime("1:45:00")).toBe(6300);
    expect(parseGoalTime("45:30")).toBe(2730);
    expect(parseGoalTime("45")).toBe(2700);
    expect(parseGoalTime(" 0:22:05 ")).toBe(1325);
  });
  it("rejects junk and out-of-range fields", () => {
    expect(parseGoalTime("")).toBeNull();
    expect(parseGoalTime("fast")).toBeNull();
    expect(parseGoalTime("1:75:00")).toBeNull();
    expect(parseGoalTime("1:2:3:4")).toBeNull();
    expect(parseGoalTime("0")).toBeNull();
  });
  it("round trips", () => {
    expect(formatGoalTime(6300)).toBe("1:45:00");
    expect(formatGoalTime(2730)).toBe("45:30");
  });
});
