import { eq } from "drizzle-orm";
import { db } from "../db";
import { athletes } from "../db/schema";
import { getSession, isDemoSession } from "../lib/session";
import { NavLinks } from "./nav-links";

/**
 * One header for every page, rendered from the root layout. Reads the
 * session so it knows whether to show Dashboard and which account button
 * to offer. Signed out, "Sign in" goes to the welcome page, where Strava's
 * own Connect button starts the login; Strava's brand rules require that
 * button, so this header never links straight into OAuth.
 */
export async function SiteHeader() {
  const session = await getSession();
  const athlete = session ? await db.query.athletes.findFirst({ where: eq(athletes.id, session.athleteId) }) : null;
  const demo = isDemoSession(session);
  const name = athlete ? `${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`.trim() || String(athlete.id) : null;

  const links = [
    { href: "/", label: "logrun" },
    ...(session ? [{ href: "/dashboard", label: "Dashboard" }] : []),
    { href: "/about", label: "About me" },
  ];

  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3 md:px-8">
        <NavLinks links={links} />
        {session && (
          <div className="flex items-center gap-3 text-sm">
            {name && (
              <span className="text-neutral-600">
                Signed in as <strong className="text-neutral-900">{name}</strong>
              </span>
            )}
            <form action="/auth/logout" method="post">
              <button type="submit" className="rounded border bg-blue-600 text-white px-3 py-1 hover:bg-neutral-100">
                {demo ? "Leave demo" : "Log out"}
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
