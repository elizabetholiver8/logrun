"use client";

import polyline from "@mapbox/polyline";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { chartColors } from "./theme";

/**
 * Draws a run's summary polyline on OpenStreetMap tiles. Leaflet touches
 * `window` at import time, so this component is only ever rendered on the
 * client; the run page loads it with next/dynamic and ssr: false.
 */
export function RunMap({ encoded }: { encoded: string }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const points = polyline.decode(encoded) as [number, number][];
    if (points.length === 0) return;

    const map = L.map(el.current, { zoomControl: true, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const line = L.polyline(points, { color: chartColors.route, weight: 4 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [20, 20] });

    return () => {
      map.remove();
    };
  }, [encoded]);

  return <div ref={el} className="h-80 w-full rounded border border-neutral-200" />;
}
