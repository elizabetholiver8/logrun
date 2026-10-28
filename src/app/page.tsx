import { count, eq } from "drizzle-orm";
import Image from "next/image";
import { Suspense } from "react";
import { SyncButton } from "../components/sync-button";
import { db } from "../db";
import { activities, athletes } from "../db/schema";
import { getSession } from "../lib/session";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <h1 className="text-3xl font-semibold">logrun</h1>
      <p className="text-neutral-600">
        Run tracking and training plans built on your Strava history.
      </p>
      <Suspense fallback={<p className="text-neutral-400">Checking session…</p>}>
        <AccountStatus />
      </Suspense>
    </main>
  );
}

/**
 * Reads the session cookie, so it must sit inside a Suspense boundary: the
 * rest of the page prerenders statically and this part streams in.
 */
async function AccountStatus() {
  const session = await getSession();

  if (!session) {
    return (
      <a href="/auth/login" aria-label="Connect with Strava">
        <Image
          src="/btn_strava_connect_with_orange.svg"
          alt="Connect with Strava"
          width={193}
          height={48}
          priority
        />
      </a>
    );
  }

  const [athlete, [{ runs }]] = await Promise.all([
    db.query.athletes.findFirst({ where: eq(athletes.id, session.athleteId) }),
    db.select({ runs: count() }).from(activities).where(eq(activities.athleteId, session.athleteId)),
  ]);

  const name = athlete ? `${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`.trim() : String(session.athleteId);

  return (
    <div className="flex flex-col gap-4">
      <p>
        Signed in as <strong>{name}</strong>. {runs} runs stored
        {athlete?.backfillCompletedAt ? "." : ", history not yet complete."}
      </p>
      <SyncButton backfillComplete={Boolean(athlete?.backfillCompletedAt)} />
      <form action="/auth/logout" method="post">
        <button
          type="submit"
          className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
        >
          Log out
        </button>
      </form>
    </div>
  );
}
