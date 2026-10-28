import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { StravaApiError } from "../../../lib/strava";
import { syncActivities } from "../../../lib/sync";

/**
 * POST /api/sync
 * Runs one bounded sync pass for the signed-in athlete and reports progress.
 * The client calls it again while `done` is false.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  try {
    const result = await syncActivities(session.athleteId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof StravaApiError) {
      return NextResponse.json(
        { error: "strava_error", status: err.status, message: err.message },
        { status: 502 },
      );
    }
    throw err;
  }
}
