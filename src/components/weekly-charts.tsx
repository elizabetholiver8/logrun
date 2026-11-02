"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPace, metersToDistance, unitLabel, type Units, type WeekBucket } from "../lib/units";
import { chartColors } from "./theme";

type Point = { week: string; label: string; distance: number; pace: number | null; partial: boolean };

function toPoints(weekly: WeekBucket[], units: Units): Point[] {
  return weekly.map((w, i) => {
    const d = metersToDistance(w.distanceM, units);
    const [, m, day] = w.week.split("-");
    return {
      week: w.week,
      label: `${Number(m)}/${Number(day)}`,
      distance: Math.round(d * 10) / 10,
      pace: d > 0 ? w.movingTimeS / d : null,
      // The last bucket is the current, unfinished week.
      partial: i === weekly.length - 1,
    };
  });
}

/** Hollow dot on the in-progress week so a two-run average does not read as a trend. */
function PartialDot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props;
  if (!payload?.partial || cx === undefined || cy === undefined) return null;
  return <circle cx={cx} cy={cy} r={4} fill="#fff" stroke={chartColors.line} strokeWidth={2} />;
}

export function WeeklyCharts({ weekly, units }: { weekly: WeekBucket[]; units: Units }) {
  const points = toPoints(weekly, units);
  const u = unitLabel(units);
  const paced = points.filter((p) => p.pace !== null);

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Weekly distance, {u}</h2>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={points} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={chartColors.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} interval={3} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: chartColors.axis }} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v) => [`${v} ${u}`, "Distance"]}
                labelFormatter={(_, p) => `Week of ${p?.[0]?.payload?.week ?? ""}${p?.[0]?.payload?.partial ? " (in progress)" : ""}`}
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
              />
              <Bar dataKey="distance" fill={chartColors.bar} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Average pace, min/{u}</h2>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={paced} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={chartColors.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} interval={3} tickLine={false} axisLine={false} />
              <YAxis
                reversed
                domain={["dataMin - 30", "dataMax + 30"]}
                tickFormatter={(v: number) => formatPace(v)}
                tick={{ fontSize: 11, fill: chartColors.axis }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip
                formatter={(v) => [formatPace(Number(v)), "Pace"]}
                labelFormatter={(_, p) => `Week of ${p?.[0]?.payload?.week ?? ""}${p?.[0]?.payload?.partial ? " (in progress)" : ""}`}
              />
              <Line type="monotone" dataKey="pace" stroke={chartColors.line} strokeWidth={2} dot={<PartialDot />} activeDot={{ r: 4 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
