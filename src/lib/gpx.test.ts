import { describe, expect, it } from "vitest";
import { HILLY_GAIN_PER_KM, buildProfile, categorize, gainAndLoss, parseGpxPoints } from "./gpx";

/**
 * Synthetic course: points every ~50 m heading north from (39, -76.6).
 * One degree of latitude is about 111 km, so 0.00045 deg is about 50 m.
 */
function gpx(elevations: number[], tag = "trkpt"): string {
  const pts = elevations
    .map((e, i) => `<${tag} lat="${(39 + i * 0.00045).toFixed(6)}" lon="-76.600000"><ele>${e}</ele><time>2026-01-01T00:00:00Z</time></${tag}>`)
    .join("\n");
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>test</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

describe("parseGpxPoints", () => {
  it("reads trkpt and rtept elements and skips ones without elevation", () => {
    expect(parseGpxPoints(gpx([10, 20, 30]))).toHaveLength(3);
    expect(parseGpxPoints(gpx([10, 20], "rtept"))).toHaveLength(2);
    expect(parseGpxPoints('<gpx><trk><trkseg><trkpt lat="1" lon="2"></trkpt></trkseg></trk></gpx>')).toHaveLength(0);
  });
});

describe("gainAndLoss", () => {
  it("ignores wobble below the hysteresis and counts real climbs", () => {
    expect(gainAndLoss([100, 101, 100, 102, 100, 101])).toEqual({ gainM: 0, lossM: 0 });
    expect(gainAndLoss([100, 110, 105, 120, 100])).toEqual({ gainM: 25, lossM: 25 });
  });
});

describe("buildProfile", () => {
  it("builds a flat profile", () => {
    const p = buildProfile(gpx(Array.from({ length: 200 }, (_, i) => 50 + Math.sin(i / 3))));
    expect(p.distanceM).toBeGreaterThan(9_500);
    expect(p.category).toBe("flat");
    expect(p.gainM).toBeLessThan(20);
    expect(p.points.length).toBeGreaterThan(50);
    expect(p.points[0][0]).toBe(0);
    expect(p.points.at(-1)![0]).toBe(p.distanceM);
  });
  it("finds the longest climb and classifies a hilly course", () => {
    // 10 km: 2 km flat, 2 km climbing 160 m (8%), 2 km flat, 2 km descending, 2 km flat.
    const ele: number[] = [];
    for (let i = 0; i < 200; i++) {
      if (i < 40) ele.push(100);
      else if (i < 80) ele.push(100 + (i - 40) * 4);
      else if (i < 120) ele.push(260);
      else if (i < 160) ele.push(260 - (i - 120) * 4);
      else ele.push(100);
    }
    const p = buildProfile(gpx(ele));
    expect(p.gainM).toBeGreaterThan(150);
    expect(p.gainM).toBeLessThan(170);
    expect(p.lossM).toBeCloseTo(p.gainM, -1);
    expect(p.category).toBe("hilly"); // 160 m over 10 km is 16 m/km
    expect(p.gainPerKm).toBeGreaterThan(HILLY_GAIN_PER_KM);
    expect(p.longestClimb).not.toBeNull();
    expect(p.longestClimb!.gainM).toBeGreaterThan(150);
    expect(p.longestClimb!.startM).toBeGreaterThan(1800);
    expect(p.longestClimb!.startM).toBeLessThan(2200);
    expect(p.longestClimb!.gradePct).toBeGreaterThan(6);
    expect(p.longestClimb!.gradePct).toBeLessThan(10);
    expect(p.maxGradePct).toBeGreaterThan(6);
  });
  it("rejects files with no usable track", () => {
    expect(() => buildProfile("<gpx></gpx>")).toThrow(/No track points/);
    expect(() => buildProfile(gpx([1, 2]))).toThrow(/too short/);
  });
});

describe("categorize", () => {
  it("uses the thresholds, calibrated to road marathons", () => {
    expect(categorize(1.5)).toBe("flat"); // Chicago, Berlin
    expect(categorize(5)).toBe("rolling");
    expect(categorize(6.5)).toBe("rolling"); // New York
    expect(categorize(12)).toBe("hilly");
  });
  it("lets one big climb raise the class of a flat-average course", () => {
    expect(categorize(2, 30)).toBe("rolling");
    expect(categorize(2, 80)).toBe("hilly"); // Boston's Newton hills on a net-downhill course
  });
  it("keeps sparse tracks unsmoothed so short hills survive", () => {
    // One point every 500 m, a 40 m hill over 1 km in the middle of 10 km.
    const ele = Array.from({ length: 21 }, (_, i) => (i === 10 ? 120 : i === 9 || i === 11 ? 100 : 80));
    const pts = ele.map((e, i) => `<trkpt lat="${(39 + i * 0.0045).toFixed(6)}" lon="-76.6"><ele>${e}</ele></trkpt>`).join("");
    const p = buildProfile(`<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`);
    expect(p.gainM).toBe(40);
    expect(p.longestClimb?.gainM).toBe(40);
  });
});
