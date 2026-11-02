import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { getSession } from "../lib/session";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <h1 className="text-3xl font-semibold">logrun</h1>
      <p className="text-neutral-600">
        Run tracking and training plans built on your Strava history.
      </p>
      <Suspense fallback={<p className="text-neutral-400">Checking session…</p>}>
        <Entry />
      </Suspense>
    </main>
  );
}

/** Reads the session cookie, so it sits inside Suspense and streams in. */
async function Entry() {
  const session = await getSession();
  if (session) {
    return (
      <Link href="/dashboard" className="w-fit rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">
        Open dashboard
      </Link>
    );
  }
  return (
    <a href="/auth/login" aria-label="Connect with Strava" className="w-fit">
      <Image src="/btn_strava_connect_with_orange.svg" alt="Connect with Strava" width={193} height={48} priority />
    </a>
  );
}
