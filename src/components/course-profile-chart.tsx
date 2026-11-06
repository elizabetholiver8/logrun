import type { CourseProfileJson } from "../db/schema";
import { metersToDistance, unitLabel, type Units } from "../lib/units";

const W = 600;
const H = 140;
const PAD = { top: 10, right: 10, bottom: 22, left: 44 };

/**
 * Elevation profile as inline SVG. Server rendered, no chart library: a
 * single filled polyline is all a profile needs, and it prints.
 */
export function CourseProfileChart({ course, units }: { course: CourseProfileJson; units: Units }) {
  const pts = course.points;
  if (pts.length < 2) return null;
  const toH = (m: number) => (units === "miles" ? m * 3.28084 : m);
  const heightUnit = units === "miles" ? "ft" : "m";
  const minE = Math.min(...pts.map((p) => p[1]));
  const maxE = Math.max(...pts.map((p) => p[1]));
  const span = Math.max(maxE - minE, 10);
  const x = (d: number) => PAD.left + (d / course.distanceM) * (W - PAD.left - PAD.right);
  const y = (e: number) => PAD.top + (1 - (e - minE) / span) * (H - PAD.top - PAD.bottom);
  const line = pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${y(minE).toFixed(1)} ${line} ${x(course.distanceM).toFixed(1)},${y(minE).toFixed(1)}`;
  const climb = course.longestClimb;
  const total = metersToDistance(course.distanceM, units);
  const ticks = Array.from({ length: Math.floor(total) + 1 }, (_, i) => i).filter((i) => i % Math.max(1, Math.round(total / 8)) === 0);
  const perUnit = units === "miles" ? 1609.344 : 1000;

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl text-neutral-500" role="img" aria-label="Course elevation profile">
        {climb && (
          <rect x={x(climb.startM)} y={PAD.top} width={Math.max(2, x(climb.startM + climb.lengthM) - x(climb.startM))} height={H - PAD.top - PAD.bottom} fill="#f97316" opacity="0.15" />
        )}
        <polygon points={area} fill="#737373" opacity="0.2" />
        <polyline points={line} fill="none" stroke="#404040" strokeWidth="1.5" />
        {[minE, maxE].map((e) => (
          <text key={e} x={PAD.left - 6} y={y(e) + 4} textAnchor="end" fontSize="10" fill="currentColor">
            {Math.round(toH(e))}
          </text>
        ))}
        <text x={4} y={PAD.top + 10} fontSize="9" fill="currentColor">{heightUnit}</text>
        {ticks.map((t) => (
          <text key={t} x={x(t * perUnit)} y={H - 6} textAnchor="middle" fontSize="10" fill="currentColor">{t}</text>
        ))}
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="9" fill="currentColor">{unitLabel(units)}</text>
      </svg>
      <figcaption className="text-xs text-neutral-600">
        {course.category === "flat" ? "Flat" : course.category === "rolling" ? "Rolling" : "Hilly"} course: {Math.round(toH(course.gainM))} {heightUnit} of climbing over {total.toFixed(1)} {unitLabel(units)}
        {climb
          ? `, longest climb ${metersToDistance(climb.lengthM, units).toFixed(1)} ${unitLabel(units)} at ${climb.gradePct}% starting at ${metersToDistance(climb.startM, units).toFixed(1)} ${unitLabel(units)} (shaded)`
          : ""}
        .
      </figcaption>
    </figure>
  );
}
