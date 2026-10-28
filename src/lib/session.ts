import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection, type NextResponse } from "next/server";
import { env } from "./env";

/**
 * Stateless signed-cookie sessions.
 *
 * The cookie value is base64url(JSON payload) . base64url(HMAC-SHA256).
 * Nothing is stored server side; the signature is what makes it trustworthy.
 * The payload carries only the athlete ID and an expiry, so there is nothing
 * sensitive to leak if the cookie is read.
 */

export const SESSION_COOKIE = "logrun_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type SessionPayload = {
  athleteId: number;
  /** Unix seconds. */
  exp: number;
};

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Pure function: builds a cookie value. Exported for tests. */
export function encodeSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/**
 * Pure function: verifies and parses a cookie value. Returns null for a
 * missing, tampered, malformed or expired token. Exported for tests.
 */
export function decodeSession(
  token: string | undefined,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, secret);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as SessionPayload).athleteId !== "number" ||
    typeof (payload as SessionPayload).exp !== "number"
  ) {
    return null;
  }
  const session = payload as SessionPayload;
  if (session.exp <= now) return null;
  return session;
}

/** Read the current session inside a server component or route handler. */
export async function getSession(): Promise<SessionPayload | null> {
  // Declare this as request-time work before touching the clock; with cache
  // components on, Next refuses an unflagged Date.now() during prerendering.
  await connection();
  const store = await cookies();
  const now = Math.floor(Date.now() / 1000);
  return decodeSession(store.get(SESSION_COOKIE)?.value, env.SESSION_SECRET, now);
}

/** Attach a fresh session cookie to a response. */
export function setSessionCookie(res: NextResponse, athleteId: number): void {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  res.cookies.set(SESSION_COOKIE, encodeSession({ athleteId, exp }, env.SESSION_SECRET), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}
