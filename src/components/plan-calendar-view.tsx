"use client";

import { useSyncExternalStore } from "react";
import type { PlanView } from "../lib/plan-data";
import type { Units } from "../lib/units";
import { PlanCalendar } from "./plan-calendar";

const STORAGE_KEY = "logrun.plan.details";
const EVENT = "logrun:plan-details";

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Calendar with a "Show details" switch. The choice is kept in this
 * browser only; it is a viewing preference, not data. Read through
 * useSyncExternalStore so the server render and the first client render
 * agree, then the stored value takes over.
 */
export function PlanCalendarView({ view, units, today }: { view: PlanView; units: Units; today: string }) {
  const details = useSyncExternalStore(subscribe, read, () => false);
  function toggle(next: boolean) {
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable; the event below still updates this page.
    }
    window.dispatchEvent(new Event(EVENT));
  }
  return (
    <div className="flex flex-col gap-3">
      <label className="flex w-fit items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={details} onChange={(e) => toggle(e.target.checked)} />
        Show details in each day
      </label>
      <PlanCalendar view={view} units={units} today={today} details={details} />
    </div>
  );
}
