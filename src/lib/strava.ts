import { eq } from "drizzle-orm";
import { db } from "../db";
import { athletes, stravaTokens } from "../db/schema";
import { decrypt, encrypt } from "./crypto";
import { env } from "./env";

/**
 * Strava OAuth and API client.
 *
 * Every call to the Strava API goes through stravaFetch, which guarantees a
 * valid access token. Access tokens expire every six hours; refresh happens
 * automatically when one is within REFRESH_MARGIN_S of expiry.
 */

const OAUTH_BASE = "https://www.strava.com/oauth";
export const API_BASE = process.env.STRAVA_API_BASE ?? "https://www.strava.com/api/v3";

/** Scopes this app needs. read is required by Strava; activity:read_all includes private runs. */
export const REQUIRED_SCOPES = ["read", "activity:read_all"] as const;

const REFRESH_MARGIN_S = 5 * 60;

export type StravaAthleteSummary = {
  id: number;
  firstname?: string;
  lastname?: string;
  profile?: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  measurement_preference?: "feet" | "meters";
};

type TokenResponse = {
  token_type: "Bearer";
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at: number;
  expires_in: number;
  /** Present on the initial code exchange only. */
  athlete?: StravaAthleteSummary;
};

export class StravaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly rateLimit?: { limit: string | null; usage: string | null },
  ) {
    super(message);
    this.name = "StravaApiError";
  }
}

/** Build the URL that sends a user to Strava's consent screen. */
export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: REQUIRED_SCOPES.join(","),
    state,
  });
  return `${OAUTH_BASE}/authorize?${params.toString()}`;
}

/** True when the scope string Strava sent back covers everything we need. */
export function hasRequiredScopes(scope: string | null): boolean {
  if (!scope) return false;
  const granted = new Set(scope.split(","));
  return REQUIRED_SCOPES.every((s) => granted.has(s));
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      ...body,
    }),
  });
  if (!res.ok) {
    throw new StravaApiError(res.status, `Token request failed: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Exchange the one-time code from the callback for tokens plus the athlete profile. */
export async function exchangeCode(code: string): Promise<TokenResponse & { athlete: StravaAthleteSummary }> {
  const tokens = await postToken({ code, grant_type: "authorization_code" });
  if (!tokens.athlete) {
    throw new StravaApiError(500, "Token exchange returned no athlete");
  }
  return tokens as TokenResponse & { athlete: StravaAthleteSummary };
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return postToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
}

/** Encrypt and upsert a token set for an athlete. */
export async function storeTokens(
  athleteId: number,
  tokens: Pick<TokenResponse, "access_token" | "refresh_token" | "expires_at">,
  scope?: string | null,
): Promise<void> {
  const secret = env.SESSION_SECRET;
  const values = {
    athleteId,
    accessTokenEnc: encrypt(tokens.access_token, secret),
    refreshTokenEnc: encrypt(tokens.refresh_token, secret),
    expiresAt: new Date(tokens.expires_at * 1000),
    scope: scope ?? undefined,
    updatedAt: new Date(),
  };
  await db
    .insert(stravaTokens)
    .values(values)
    .onConflictDoUpdate({
      target: stravaTokens.athleteId,
      set: {
        accessTokenEnc: values.accessTokenEnc,
        refreshTokenEnc: values.refreshTokenEnc,
        expiresAt: values.expiresAt,
        ...(scope ? { scope } : {}),
        updatedAt: values.updatedAt,
      },
    });
}

/** Insert or update the athlete profile row from Strava's athlete object. */
export async function upsertAthlete(a: StravaAthleteSummary): Promise<void> {
  const values = {
    id: a.id,
    firstName: a.firstname ?? null,
    lastName: a.lastname ?? null,
    profileUrl: a.profile ?? null,
    city: a.city ?? null,
    state: a.state ?? null,
    country: a.country ?? null,
    measurementPreference: a.measurement_preference ?? null,
    updatedAt: new Date(),
    deauthorizedAt: null,
  };
  await db
    .insert(athletes)
    .values(values)
    .onConflictDoUpdate({ target: athletes.id, set: values });
}

/**
 * Return a usable access token for the athlete, refreshing and persisting a
 * new one if the stored token is expired or about to expire.
 */
export async function getValidAccessToken(athleteId: number): Promise<string> {
  const row = await db.query.stravaTokens.findFirst({
    where: eq(stravaTokens.athleteId, athleteId),
  });
  if (!row) {
    throw new StravaApiError(401, `No Strava tokens stored for athlete ${athleteId}`);
  }

  const secret = env.SESSION_SECRET;
  const nowS = Math.floor(Date.now() / 1000);
  const expiresS = Math.floor(row.expiresAt.getTime() / 1000);

  if (expiresS - nowS > REFRESH_MARGIN_S) {
    return decrypt(row.accessTokenEnc, secret);
  }

  const fresh = await refreshTokens(decrypt(row.refreshTokenEnc, secret));
  await storeTokens(athleteId, fresh);
  return fresh.access_token;
}

/** Parsed rate-limit state from Strava's response headers. */
export type RateLimit = {
  /** Requests used in the current 15-minute window. */
  shortUsage: number;
  /** Cap for the 15-minute window. */
  shortLimit: number;
  /** Requests used today. */
  dailyUsage: number;
  /** Cap for today. */
  dailyLimit: number;
};

/**
 * Parse "X-RateLimit-Limit: 200,2000" style headers. Strava sends a separate
 * read-only pair (X-ReadRateLimit-*) which is the one that applies to GETs;
 * fall back to the overall pair when the read pair is absent. Returns null
 * when neither is present, which happens on some error responses.
 */
export function parseRateLimit(headers: Headers): RateLimit | null {
  const limit = headers.get("x-readratelimit-limit") ?? headers.get("x-ratelimit-limit");
  const usage = headers.get("x-readratelimit-usage") ?? headers.get("x-ratelimit-usage");
  if (!limit || !usage) return null;
  const [shortLimit, dailyLimit] = limit.split(",").map(Number);
  const [shortUsage, dailyUsage] = usage.split(",").map(Number);
  if ([shortLimit, dailyLimit, shortUsage, dailyUsage].some(Number.isNaN)) return null;
  return { shortUsage, shortLimit, dailyUsage, dailyLimit };
}

/**
 * Authenticated fetch against the Strava API, returning the parsed body and
 * the rate-limit state. Path is relative to API_BASE, e.g.
 * "/athlete/activities?per_page=50". Throws StravaApiError on non-2xx.
 */
export async function stravaFetchWithRateLimit<T>(
  athleteId: number,
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; rateLimit: RateLimit | null }> {
  const token = await getValidAccessToken(athleteId);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new StravaApiError(res.status, `Strava ${path} returned ${res.status}`, {
      limit: res.headers.get("x-ratelimit-limit"),
      usage: res.headers.get("x-ratelimit-usage"),
    });
  }
  return { data: (await res.json()) as T, rateLimit: parseRateLimit(res.headers) };
}

/** Authenticated fetch that returns only the parsed body. */
export async function stravaFetch<T>(
  athleteId: number,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return (await stravaFetchWithRateLimit<T>(athleteId, path, init)).data;
}
