import { after, NextResponse } from "next/server";
import { env } from "../../../../lib/env";
import { parseEvent, processEvent, recordEvent, validateSubscription } from "../../../../lib/webhooks";

/**
 * GET /api/webhooks/strava
 * Subscription handshake. Strava calls this once when the subscription is
 * created and expects the challenge echoed back as JSON.
 */
export async function GET(req: Request) {
  const challenge = validateSubscription(new URL(req.url).searchParams, env.STRAVA_WEBHOOK_VERIFY_TOKEN);
  if (!challenge) {
    return NextResponse.json({ error: "verification_failed" }, { status: 403 });
  }
  return NextResponse.json({ "hub.challenge": challenge });
}

/**
 * POST /api/webhooks/strava
 * Event delivery. Stores the event, acknowledges immediately, then
 * processes it after the response is sent so Strava's two-second deadline
 * is never at risk. Malformed bodies get a 400 so Strava stops retrying.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const event = parseEvent(body);
  if (!event) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const rowId = await recordEvent(event);
  after(() => processEvent(rowId, event));
  return NextResponse.json({ received: true });
}
