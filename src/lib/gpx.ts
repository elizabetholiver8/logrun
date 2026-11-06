/**
 * Race course profile from a GPX file. Pure string and number work, no DOM
 * and no XML library: a GPX track is a flat list of <trkpt> or <rtept>
 * elements, and a regular expression over them is faster and smaller than a
 * parser for the two attributes and one child we need.
 */

export type CourseProfile = {
  /** Downsampled [distance m, elevation m] pairs for drawing. */
  points: [number, number][];
  distanceM: number;
  gainM: number;
  lossM: number;
  /** Metres of climbing per kilometre, the main difficulty measure. */
  gainPerKm: number;
  /** The longest sustained climb. */
  longestClimb: { startM: number; lengthM: number; gainM: number; gradePct: number } | null;
  /** Steepest average grade over any GRADE_WINDOW_M stretch, percent. */
  maxGradePct: number;
  category: CourseCategory;
};

export type CourseCategory = "flat" | "rolling" | "hilly";

/**
 * Gain per km thresholds, calibrated on road races: Chicago and Berlin are
 * under 2 m/km, New York about 6.5, Boston about 5.5 with one big climb,
 * trail and mountain races 15 and up. 3 m/km is about 16 ft/mi; 7.5 m/km
 * about 40 ft/mi.
 */
export const ROLLING_GAIN_PER_KM = 3;
export const HILLY_GAIN_PER_KM = 7.5;
/** A single climb of this much gain makes a course at least rolling, or hilly, whatever the average. */
export const ROLLING_CLIMB_M = 25;
export const HILLY_CLIMB_M = 60;
/** Elevation must move this far before it counts, to ignore GPS jitter. */
export const HYSTERESIS_M = 3;
/** Smoothing covers about this much distance; the point window is derived from spacing. */
const SMOOTH_DISTANCE_M = 60;
const GRADE_WINDOW_M = 400;
const PROFILE_POINTS = 120;
/** A climb may dip by this much and still be one climb. */
const CLIMB_DIP_M = 5;

type TrackPoint = { lat: number; lon: number; ele: number };

const POINT_RE = /<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>/g;
const LAT_RE = /\blat="(-?[\d.]+)"/;
const LON_RE = /\blon="(-?[\d.]+)"/;
const ELE_RE = /<ele>\s*(-?[\d.]+)\s*<\/ele>/;

export function parseGpxPoints(xml: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const m of xml.matchAll(POINT_RE)) {
    const lat = LAT_RE.exec(m[1]);
    const lon = LON_RE.exec(m[1]);
    const ele = ELE_RE.exec(m[2]);
    if (!lat || !lon || !ele) continue;
    const p = { lat: Number(lat[1]), lon: Number(lon[1]), ele: Number(ele[1]) };
    if ([p.lat, p.lon, p.ele].some((n) => !Number.isFinite(n))) continue;
    points.push(p);
  }
  return points;
}

function haversineM(a: TrackPoint, b: TrackPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function smooth(values: number[], window: number): number[] {
  if (window <= 1) return values.slice();
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    return sum / (hi - lo + 1);
  });
}

/**
 * Total gain and loss with hysteresis: elevation has to move HYSTERESIS_M
 * from the last turning point before a change is counted, which is how
 * Strava and most watches avoid counting GPS noise as climbing.
 */
export function gainAndLoss(elevations: number[]): { gainM: number; lossM: number } {
  let gainM = 0;
  let lossM = 0;
  if (elevations.length === 0) return { gainM, lossM };
  let anchor = elevations[0];
  for (const e of elevations) {
    const diff = e - anchor;
    if (diff >= HYSTERESIS_M) {
      gainM += diff;
      anchor = e;
    } else if (diff <= -HYSTERESIS_M) {
      lossM += -diff;
      anchor = e;
    }
  }
  return { gainM, lossM };
}

export function buildProfile(xml: string): CourseProfile {
  const raw = parseGpxPoints(xml);
  if (raw.length < 2) throw new Error("No track points with elevation found in the file");

  const cum: number[] = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + haversineM(raw[i - 1], raw[i]));
  const distanceM = cum[cum.length - 1];
  if (distanceM < 100) throw new Error("The track is too short to be a race course");

  // Dense tracks get a wider window; sparse ones, a point every 100 m or
  // more, are left alone so real hills are not averaged away.
  const spacing = distanceM / (raw.length - 1);
  const window = Math.max(1, Math.min(7, Math.round(SMOOTH_DISTANCE_M / spacing)));
  const ele = smooth(raw.map((p) => p.ele), window);
  const { gainM, lossM } = gainAndLoss(ele);
  const gainPerKm = gainM / (distanceM / 1000);
  const climb = longestClimb(cum, ele);

  return {
    points: downsample(cum, ele, PROFILE_POINTS),
    distanceM: Math.round(distanceM),
    gainM: Math.round(gainM),
    lossM: Math.round(lossM),
    gainPerKm: Math.round(gainPerKm * 10) / 10,
    longestClimb: climb,
    maxGradePct: maxGrade(cum, ele),
    category: categorize(gainPerKm, climb?.gainM ?? 0),
  };
}

/** Average climbing rate decides, but one big climb on an otherwise flat course still counts. */
export function categorize(gainPerKm: number, longestClimbM = 0): CourseCategory {
  if (gainPerKm >= HILLY_GAIN_PER_KM || longestClimbM >= HILLY_CLIMB_M) return "hilly";
  if (gainPerKm >= ROLLING_GAIN_PER_KM || longestClimbM >= ROLLING_CLIMB_M) return "rolling";
  return "flat";
}

function downsample(cum: number[], ele: number[], n: number): [number, number][] {
  if (cum.length <= n) return cum.map((d, i) => [Math.round(d), Math.round(ele[i] * 10) / 10]);
  const out: [number, number][] = [];
  const total = cum[cum.length - 1];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    while (j < cum.length - 1 && cum[j + 1] <= target) j++;
    out.push([Math.round(target), Math.round(ele[j] * 10) / 10]);
  }
  return out;
}

/**
 * Longest climb: the stretch with the most gain where elevation never drops
 * more than CLIMB_DIP_M below its running high. Runners feel a climb as one
 * thing even with a short flat or dip in it.
 */
function longestClimb(cum: number[], ele: number[]): CourseProfile["longestClimb"] {
  let best: CourseProfile["longestClimb"] = null;
  let start = 0;
  let low = ele[0];
  let high = ele[0];
  let highIdx = 0;
  const consider = () => {
    const gain = high - low;
    if (gain >= 10 && (!best || gain > best.gainM)) {
      const length = cum[highIdx] - cum[start];
      best = {
        startM: Math.round(cum[start]),
        lengthM: Math.round(length),
        gainM: Math.round(gain),
        gradePct: length > 0 ? Math.round((gain / length) * 1000) / 10 : 0,
      };
    }
  };
  for (let i = 1; i < ele.length; i++) {
    if (ele[i] > high) {
      high = ele[i];
      highIdx = i;
    } else if (high - ele[i] > CLIMB_DIP_M) {
      consider();
      start = i;
      low = ele[i];
      high = ele[i];
      highIdx = i;
    }
    if (ele[i] <= low && high - low < HYSTERESIS_M) {
      // Flat or descending before the climb starts: slide the start forward.
      start = i;
      low = ele[i];
      high = ele[i];
      highIdx = i;
    }
  }
  consider();
  return best;
}

function maxGrade(cum: number[], ele: number[]): number {
  let best = 0;
  let j = 0;
  for (let i = 0; i < cum.length; i++) {
    while (j < cum.length - 1 && cum[j] - cum[i] < GRADE_WINDOW_M) j++;
    const run = cum[j] - cum[i];
    if (run >= GRADE_WINDOW_M * 0.75) {
      const grade = ((ele[j] - ele[i]) / run) * 100;
      if (grade > best) best = grade;
    }
  }
  return Math.round(best * 10) / 10;
}
