import Image from "next/image";

/** Shown on every signed-in page while the session is the read-only demo. */
export function DemoBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span className="min-w-0 flex-1">
        <strong>Sample data.</strong> A real runner&apos;s history, anonymized and date-shifted. Plans you build here are previewed, not saved; syncing is off.
      </span>
      <a href="/auth/login" aria-label="Connect with Strava" className="shrink-0">
        <Image src="/btn_strava_connect_with_orange.svg" alt="Connect with Strava" width={129} height={32} />
      </a>
    </div>
  );
}
