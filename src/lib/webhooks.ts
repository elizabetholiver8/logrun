import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { activities, athletes, stravaTokens, webhookEvents } from "../db/schema";
import { StravaApiError, stravaFetch } from "./strava";
import { RUN_SPORT_TYPES, upsertRuns, type StravaSummaryActivity } from "./sync";

/**
 * Strava webhook handling.
 *
 * Strava sends one subscription-validation GET when a subscription is
 * created, then POSTs an event for every activity create/update/delete and
 * for athlete deauthorization. It expects a 200 within two seconds and
 * retries otherwise, so the route stores the event first and processes it
 * after responding.
 *
 * Reference: https://developers.strava.com/docs/webhooks/
 */

export type StravaWebhookEvent = {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
  owner_id: number;
  subscription_id: number;
  /** Unix seconds. */
  event_time: number;
  updates?: Record<string, string>;
};

/**
 * Pure: answer the subscription handshake. Returns the challenge to echo
 * when the mode and token are right, otherwise null. Exported for tests.
 */
export function validateSubscription(
  params: URLSearchParams,
  expectedToken: string,
): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || token !== expectedToken || !challenge) return null;
  return challenge;
}

/** Pure: validate an incoming event body. Returns null for anything malformed. */
export function parseEvent(body: unknown): StravaWebhookEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const objectType = b.object_type;
  const aspectType = b.aspect_type;
  if (objectType !== "activity" && objectType !== "athlete") return null;
  if (aspectType !== "create" && aspectType !== "update" && aspectType !== "delete") return null;
  if (
    typeof b.object_id !== "number" ||
    typeof b.owner_id !== "number" ||
    typeof b.subscription_id !== "number" ||
    typeof b.event_time !== "number"
  ) {
    return null;
  }
  const updates =
    typeof b.updates === "object" && b.updates !== null
      ? Object.fromEntries(
          Object.entries(b.updates as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : undefined;
  return {
    object_type: objectType,
    object_id: b.object_id,
    aspect_type: aspectType,
    owner_id: b.owner_id,
    subscription_id: b.subscription_id,
    event_time: b.event_time,
    updates,
  };
}

export type WebhookAction =
  | { kind: "upsert_activity"; activityId: number; athleteId: number }
  | { kind: "delete_activity"; activityId: number; athleteId: number }
  | { kind: "deauthorize"; athleteId: number }
  | { kind: "ignore"; reason: string };

/** Pure: decide what an event means for our data. Exported for tests. */
export function decideAction(e: StravaWebhookEvent): WebhookAction {
  if (e.object_type === "activity") {
    if (e.aspect_type === "delete") {
      return { kind: "delete_activity", activityId: e.object_id, athleteId: e.owner_id };
    }
    return { kind: "upsert_activity", activityId: e.object_id, athleteId: e.owner_id };
  }
  // Athlete events: the only one Strava sends is an update carrying
  // authorized=false when the athlete revokes access.
  if (e.aspect_type === "update" && e.updates?.authorized === "false") {
    return { kind: "deauthorize", athleteId: e.object_id };
  }
  return { kind: "ignore", reason: `athlete ${e.aspect_type} without deauthorization` };
}

/** Persist the raw event before any processing so nothing is lost on failure. */
export async function recordEvent(e: StravaWebhookEvent): Promise<number> {
  const [row] = await db
    .insert(webhookEvents)
    .values({
      objectType: e.object_type,
      objectId: e.object_id,
      aspectType: e.aspect_type,
      ownerId: e.owner_id,
      subscriptionId: e.subscription_id,
      eventTime: new Date(e.event_time * 1000),
      updates: e.updates ?? null,
    })
    .returning();
  return row.id;
}

/** Apply an action to the database. Throws on failure so the caller can record it. */
export async function applyAction(action: WebhookAction): Promise<void> {
  switch (action.kind) {
    case "upsert_activity": {
      let activity: StravaSummaryActivity;
      try {
        activity = await stravaFetch<StravaSummaryActivity>(
          action.athleteId,
          `/activities/${action.activityId}`,
        );
      } catch (err) {
        // Strava can send a create event for an activity the athlete has
        // already deleted again, or one we are no longer authorized to see.
        if (err instanceof StravaApiError && (err.status === 404 || err.status === 401)) {
          await deleteActivity(action.activityId, action.athleteId);
          return;
        }
        throw err;
      }
      if (RUN_SPORT_TYPES.has(activity.sport_type)) {
        await upsertRuns([activity], action.athleteId);
      } else {
        // An update may have changed the type away from running; drop our copy.
        await deleteActivity(action.activityId, action.athleteId);
      }
      return;
    }
    case "delete_activity":
      await deleteActivity(action.activityId, action.athleteId);
      return;
    case "deauthorize":
      // Strava's API agreement requires discarding an athlete's data once
      // they revoke access. Keep the athlete row, flagged, so a reconnect
      // is recognised; everything derived from their activities goes.
      await db.delete(activities).where(eq(activities.athleteId, action.athleteId));
      await db.delete(stravaTokens).where(eq(stravaTokens.athleteId, action.athleteId));
      await db
        .update(athletes)
        .set({
          deauthorizedAt: new Date(),
          backfillCursor: null,
          backfillCompletedAt: null,
          newestActivityAt: null,
        })
        .where(eq(athletes.id, action.athleteId));
      return;
    case "ignore":
      return;
  }
}

async function deleteActivity(activityId: number, athleteId: number): Promise<void> {
  await db
    .delete(activities)
    .where(and(eq(activities.id, activityId), eq(activities.athleteId, athleteId)));
}

/** Process one stored event end to end, recording the outcome on its row. */
export async function processEvent(eventRowId: number, e: StravaWebhookEvent): Promise<void> {
  try {
    await applyAction(decideAction(e));
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: null })
      .where(eq(webhookEvents.id, eventRowId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: message })
      .where(eq(webhookEvents.id, eventRowId));
    console.error(`webhook event ${eventRowId} failed:`, message);
  }
}
