import { NextResponse } from "next/server";
import { clearSessionCookie } from "../../../lib/session";

/**
 * POST /auth/logout
 * Clears the session cookie. POST rather than GET so a stray link or
 * prefetch cannot log the user out. Tokens stay stored so reconnecting is
 * instant; disconnecting from Strava is a separate, later feature.
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(`${origin}/`, { status: 303 });
  clearSessionCookie(res);
  return res;
}
