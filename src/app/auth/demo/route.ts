import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../../../db";
import { athletes } from "../../../db/schema";
import { DEMO_ATHLETE_ID } from "../../../lib/demo";
import { setSessionCookie } from "../../../lib/session";

/**
 * POST /auth/demo
 * Starts a read-only session as the seeded demo athlete. No credentials:
 * the demo is public by design. POST rather than GET so a crawler or link
 * prefetch cannot start sessions.
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const athlete = await db.query.athletes.findFirst({ where: eq(athletes.id, DEMO_ATHLETE_ID) });
  if (!athlete) {
    // The database has not been seeded; see scripts/demo-seed.ts.
    return NextResponse.redirect(`${origin}/?error=demo_unavailable`, { status: 303 });
  }
  const res = NextResponse.redirect(`${origin}/dashboard`, { status: 303 });
  setSessionCookie(res, DEMO_ATHLETE_ID, { demo: true });
  return res;
}
