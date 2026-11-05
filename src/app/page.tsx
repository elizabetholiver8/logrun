import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { getSession, isDemoSession } from "../lib/session";
import { SITE } from "../lib/site";

const FEATURES = [
  { title: "Strava sync", body: "OAuth connect, paged history backfill, then webhooks keep new, edited and deleted runs current without polling." },
  { title: "Dashboard", body: "Thirty-day totals, weekly distance and pace charts, and a route map for every run with GPS." },
  { title: "Training plans", body: "A rules engine builds a plan to a race date from your real baseline: capped weekly ramps, cutback weeks, a taper, and lifting slots that stay clear of the long run." },
  { title: "Progress tracking", body: "Each planned day is matched against synced runs, so the calendar shows what you actually did." },
];

const STACK = "Next.js, React, TypeScript, Tailwind, Drizzle ORM, Postgres on Neon, Vercel, Vitest, GitHub Actions";

const ERRORS: Record<string, string> = {
  access_denied: "Strava access was declined, so nothing was connected.",
  missing_scope: "Strava needs permission to read your activities for this app to work.",
  bad_state: "The sign-in request did not match this browser. Try again.",
  missing_params: "Strava sent an incomplete response. Try again.",
  demo_unavailable: "The demo data has not been loaded on this deployment yet.",
};

export default function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-12 p-6 md:p-10">
      <header className="flex items-baseline justify-between">
        <span className="text-2xl font-semibold">logrun</span>
        <a href={SITE.repo} className="text-sm text-neutral-500 hover:underline" target="_blank" rel="noreferrer">Source on GitHub</a>
      </header>

      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
          Run tracking and training plans, built on your Strava history.
        </h1>
        <p className="max-w-xl text-neutral-600">
          Connect a Strava account to see your own runs, or open the demo to explore with sample data. No sign-up either way.
        </p>
        <Suspense fallback={<div className="h-12" />}>
          <Entry searchParams={searchParams} />
        </Suspense>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded border border-neutral-200 p-4">
            <h2 className="mb-1 font-medium">{f.title}</h2>
            <p className="text-sm text-neutral-600">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">About me</h2>
        <p className="text-lg font-medium">{SITE.name}</p>
        <p className="max-w-xl text-neutral-600">{SITE.bio}</p>
        <div className="flex flex-wrap gap-3 pt-1">
          <a href={SITE.linkedin} target="_blank" rel="noreferrer" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">
            LinkedIn
          </a>
          <a href={SITE.github} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">
            GitHub
          </a>
        </div>
      </section>

      <footer className="border-t border-neutral-200 pt-4 text-sm text-neutral-500">
        Built with {STACK}. Run data from Strava, map tiles from OpenStreetMap.
      </footer>
    </main>
  );
}

/**
 * Reads the session cookie and the error query string, so it sits inside
 * Suspense and streams in while the rest of the page is static.
 */
async function Entry({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [session, { error }] = await Promise.all([getSession(), searchParams]);
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Try again.") : null;

  if (session) {
    const demo = isDemoSession(session);
    return (
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/dashboard" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">
          Open dashboard
        </Link>
        <span className="text-sm text-neutral-500">{demo ? "You are in the demo." : "You are signed in."}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <form action="/auth/demo" method="post">
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">
            View the demo
          </button>
        </form>
        <a href="/auth/login" aria-label="Connect with Strava" className="flex">
          <Image src="/btn_strava_connect_with_orange.svg" alt="Connect with Strava" width={193} height={48} priority />
        </a>
      </div>
      {message && <p className="text-sm text-red-700">{message}</p>}
    </div>
  );
}
