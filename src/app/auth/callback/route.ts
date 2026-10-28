import { NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH } from "../../../lib/oauth-state";
import { setSessionCookie } from "../../../lib/session";
import {
  exchangeCode,
  hasRequiredScopes,
  storeTokens,
  upsertAthlete,
} from "../../../lib/strava";
import { syncActivities } from "../../../lib/sync";

/**
 * GET /auth/callback
 * Strava redirects here after the consent screen with ?code=&scope=&state=
 * or ?error=access_denied. Verifies the CSRF state, checks the granted
 * scopes, exchanges the code, stores the athlete and tokens, and starts a
 * session.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${origin}/?error=${encodeURIComponent(reason)}`);
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: OAUTH_STATE_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  if (error) return fail(error);
  if (!code || !state) return fail("missing_params");

  const expectedState = readCookie(req.headers.get("cookie"), OAUTH_STATE_COOKIE);
  if (!expectedState || expectedState !== state) return fail("bad_state");

  if (!hasRequiredScopes(scope)) return fail("missing_scope");

  const tokens = await exchangeCode(code);
  await upsertAthlete(tokens.athlete);
  await storeTokens(tokens.athlete.id, tokens, scope);

  // Pull the most recent page so the dashboard has data on first load. One
  // page keeps this within a serverless time limit; the Sync button and
  // webhooks fill in the rest. A sync failure must not block login.
  try {
    await syncActivities(tokens.athlete.id, { maxPages: 1 });
  } catch (err) {
    console.error("initial sync failed", err);
  }

  const res = NextResponse.redirect(`${origin}/`);
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: OAUTH_STATE_COOKIE_PATH, maxAge: 0 });
  setSessionCookie(res, tokens.athlete.id);
  return res;
}

/** Minimal cookie parser; the request may carry several cookies. */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
