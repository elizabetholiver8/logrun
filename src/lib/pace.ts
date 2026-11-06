/**
 * Training paces from a goal time, using Jack Daniels' running formula.
 * Pure arithmetic, so every number here is unit tested.
 *
 * The model: a race performance implies a VDOT, a fitness score. Each
 * training intensity is a fixed fraction of VDOT, and the formula runs
 * backward from that fraction to a running speed. Fractions are Daniels'
 * published bands, widened slightly on the easy end because a range is more
 * useful on a watch than a single number.
 */

/** Seconds per kilometre, slow then fast. */
export type PaceRange = [number, number];

export type PaceZones = {
  /** VDOT, kept for display and for the weekly check-in. */
  vdot: number;
  easy: PaceRange;
  long: PaceRange;
  tempo: PaceRange;
  intervals: PaceRange;
  /** Goal race pace, a single value repeated so every zone has one shape. */
  race: PaceRange;
};

/** Oxygen cost of running at v metres per minute. */
function oxygenCost(vMPerMin: number): number {
  return -4.6 + 0.182258 * vMPerMin + 0.000104 * vMPerMin * vMPerMin;
}

/** Fraction of VO2max a runner can hold for a race of t minutes. */
function sustainableFraction(tMin: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
}

/** Speed in metres per minute that costs the given oxygen. Inverse of oxygenCost. */
function speedForCost(cost: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - cost;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export function vdotFromRace(distanceM: number, timeS: number): number {
  if (distanceM <= 0 || timeS <= 0) throw new Error("distance and time must be positive");
  const tMin = timeS / 60;
  const v = distanceM / tMin;
  return oxygenCost(v) / sustainableFraction(tMin);
}

/** Seconds per kilometre at a fraction of VDOT. */
export function paceAtFraction(vdot: number, fraction: number): number {
  const v = speedForCost(vdot * fraction);
  return (1000 / v) * 60;
}

/** Daniels' intensity bands as fractions of VDOT, slow end first. */
export const ZONE_FRACTIONS = {
  easy: [0.62, 0.72],
  long: [0.62, 0.72],
  tempo: [0.85, 0.88],
  intervals: [0.97, 1.0],
} as const;

export function paceZones(distanceM: number, goalTimeS: number): PaceZones {
  const vdot = vdotFromRace(distanceM, goalTimeS);
  const zone = (f: readonly [number, number]): PaceRange => [paceAtFraction(vdot, f[0]), paceAtFraction(vdot, f[1])];
  const racePace = goalTimeS / (distanceM / 1000);
  return {
    vdot: Math.round(vdot * 10) / 10,
    easy: zone(ZONE_FRACTIONS.easy),
    long: zone(ZONE_FRACTIONS.long),
    tempo: zone(ZONE_FRACTIONS.tempo),
    intervals: zone(ZONE_FRACTIONS.intervals),
    race: [racePace, racePace],
  };
}

/**
 * "1:45:00", "45:30" or "45" (minutes) to seconds. Returns null for anything
 * it cannot read, so the form can show a message instead of guessing.
 */
export function parseGoalTime(text: string): number | null {
  const parts = text.trim().split(":").map((p) => p.trim());
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let seconds: number;
  if (nums.length === 1) seconds = nums[0] * 60;
  else if (nums.length === 2) seconds = nums[0] * 60 + nums[1];
  else seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length >= 2 && nums[nums.length - 1] >= 60) return null;
  if (nums.length === 3 && nums[1] >= 60) return null;
  return seconds > 0 ? seconds : null;
}

export function formatGoalTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
