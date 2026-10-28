"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncResponse = {
  mode: "backfill" | "incremental";
  upserted: number;
  done: boolean;
  stoppedBecause?: "max_pages" | "rate_limit";
  error?: string;
};

/**
 * Calls POST /api/sync repeatedly until the server reports done, then
 * refreshes the server-rendered page so counts update.
 */
export function SyncButton({ backfillComplete }: { backfillComplete: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function run() {
    setState("running");
    let total = 0;
    try {
      for (let i = 0; i < 20; i++) {
        const res = await fetch("/api/sync", { method: "POST" });
        const body = (await res.json()) as SyncResponse;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        total += body.upserted;
        setMessage(`${total} runs synced…`);
        if (body.done) break;
        if (body.stoppedBecause === "rate_limit") {
          setMessage(`${total} runs synced. Strava rate limit reached; try again in 15 minutes.`);
          break;
        }
      }
      setMessage((m) => (m.endsWith("…") ? `${total} runs synced.` : m));
      setState("idle");
      router.refresh();
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Sync failed");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50"
      >
        {state === "running" ? "Syncing…" : backfillComplete ? "Sync new runs" : "Sync history"}
      </button>
      {message && <span className="text-sm text-neutral-600">{message}</span>}
    </div>
  );
}
