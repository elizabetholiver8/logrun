"use client";

import dynamic from "next/dynamic";

// Leaflet reads `window` on import, so the map component must never run on
// the server. next/dynamic with ssr: false has to live in a client component.
const RunMap = dynamic(() => import("./run-map").then((m) => m.RunMap), {
  ssr: false,
  loading: () => <div className="h-80 w-full animate-pulse rounded bg-neutral-100" />,
});

export function RunMapLoader({ encoded }: { encoded: string }) {
  return <RunMap encoded={encoded} />;
}
