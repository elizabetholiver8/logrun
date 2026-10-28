import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH } from "../../../lib/oauth-state";
import { buildAuthorizeUrl } from "../../../lib/strava";

/**
 * GET /auth/login
 * Starts the OAuth flow: mints a random state, stores it in a short-lived
 * cookie, and redirects to Strava's consent screen.
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const state = randomBytes(16).toString("base64url");
  const redirectUri = `${origin}${OAUTH_STATE_COOKIE_PATH}`;

  const res = NextResponse.redirect(buildAuthorizeUrl(redirectUri, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: 10 * 60,
  });
  return res;
}
