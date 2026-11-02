import { describe, expect, it } from "vitest";
import { decideAction, parseEvent, validateSubscription } from "./webhooks";

describe("validateSubscription", () => {
  const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "abc" });
  it("echoes the challenge for a valid handshake", () => {
    expect(validateSubscription(ok, "tok")).toBe("abc");
  });
  it("rejects a wrong token, wrong mode, or missing challenge", () => {
    expect(validateSubscription(ok, "other")).toBeNull();
    const badMode = new URLSearchParams(ok); badMode.set("hub.mode", "unsubscribe");
    expect(validateSubscription(badMode, "tok")).toBeNull();
    const noChallenge = new URLSearchParams(ok); noChallenge.delete("hub.challenge");
    expect(validateSubscription(noChallenge, "tok")).toBeNull();
  });
});

const base = { object_type: "activity", object_id: 55, aspect_type: "create", owner_id: 7, subscription_id: 1, event_time: 1700000000 };

describe("parseEvent", () => {
  it("accepts a well-formed event", () => {
    expect(parseEvent(base)).toEqual({ ...base, updates: undefined });
  });
  it("coerces update values to strings", () => {
    expect(parseEvent({ ...base, object_type: "athlete", aspect_type: "update", updates: { authorized: false } })?.updates).toEqual({ authorized: "false" });
  });
  it("rejects bad shapes", () => {
    expect(parseEvent(null)).toBeNull();
    expect(parseEvent("x")).toBeNull();
    expect(parseEvent({ ...base, object_type: "segment" })).toBeNull();
    expect(parseEvent({ ...base, aspect_type: "touch" })).toBeNull();
    expect(parseEvent({ ...base, object_id: "55" })).toBeNull();
  });
});

describe("decideAction", () => {
  it("maps activity create and update to upsert", () => {
    expect(decideAction(parseEvent(base)!)).toEqual({ kind: "upsert_activity", activityId: 55, athleteId: 7 });
    expect(decideAction(parseEvent({ ...base, aspect_type: "update" })!)).toMatchObject({ kind: "upsert_activity" });
  });
  it("maps activity delete to delete", () => {
    expect(decideAction(parseEvent({ ...base, aspect_type: "delete" })!)).toEqual({ kind: "delete_activity", activityId: 55, athleteId: 7 });
  });
  it("maps athlete deauthorization", () => {
    const e = parseEvent({ ...base, object_type: "athlete", object_id: 7, aspect_type: "update", updates: { authorized: "false" } })!;
    expect(decideAction(e)).toEqual({ kind: "deauthorize", athleteId: 7 });
  });
  it("ignores other athlete events", () => {
    const e = parseEvent({ ...base, object_type: "athlete", object_id: 7, aspect_type: "update", updates: { title: "x" } })!;
    expect(decideAction(e).kind).toBe("ignore");
  });
});
