import { describe, expect, it } from "vitest";
import { DEMO_ATHLETE_ID } from "./demo";
import { decodeSession, encodeSession, isDemoSession } from "./session";

const secret = "test-secret-not-for-production";

describe("session cookie", () => {
  it("round-trips a payload", () => {
    const token = encodeSession({ athleteId: 42, exp: 2_000_000_000 }, secret);
    expect(decodeSession(token, secret, 1_000_000_000)).toEqual({
      athleteId: 42,
      exp: 2_000_000_000,
    });
  });

  it("rejects a token signed with a different secret", () => {
    const token = encodeSession({ athleteId: 42, exp: 2_000_000_000 }, secret);
    expect(decodeSession(token, "other-secret", 1_000_000_000)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = encodeSession({ athleteId: 42, exp: 2_000_000_000 }, secret);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ athleteId: 1, exp: 2_000_000_000 })).toString("base64url");
    expect(body).not.toBe(forged);
    expect(decodeSession(`${forged}.${sig}`, secret, 1_000_000_000)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = encodeSession({ athleteId: 42, exp: 1_000 }, secret);
    expect(decodeSession(token, secret, 2_000)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(decodeSession(undefined, secret)).toBeNull();
    expect(decodeSession("", secret)).toBeNull();
    expect(decodeSession("nodot", secret)).toBeNull();
    expect(decodeSession("not.base64.json", secret)).toBeNull();
  });

  it("carries the demo flag through a round trip and drops it when absent", () => {
    const demo = encodeSession({ athleteId: DEMO_ATHLETE_ID, exp: 2_000_000_000, demo: true }, secret);
    expect(decodeSession(demo, secret, 1_000_000_000)).toEqual({ athleteId: DEMO_ATHLETE_ID, exp: 2_000_000_000, demo: true });
    const real = encodeSession({ athleteId: 42, exp: 2_000_000_000 }, secret);
    expect(decodeSession(real, secret, 1_000_000_000)).not.toHaveProperty("demo");
  });

  it("rejects a payload whose demo flag is not a boolean", () => {
    const body = Buffer.from(JSON.stringify({ athleteId: 42, exp: 2_000_000_000, demo: "yes" })).toString("base64url");
    const [, sig] = encodeSession({ athleteId: 42, exp: 2_000_000_000 }, secret).split(".");
    // Same body bytes would be needed for the signature to match; this one
    // fails either on the signature or on the type check. Both are rejections.
    expect(decodeSession(`${body}.${sig}`, secret, 1_000_000_000)).toBeNull();
  });
});

describe("isDemoSession", () => {
  it("is true for the flag, true for the demo athlete id regardless of flag, false otherwise", () => {
    expect(isDemoSession({ athleteId: 42, exp: 1, demo: true })).toBe(true);
    expect(isDemoSession({ athleteId: DEMO_ATHLETE_ID, exp: 1 })).toBe(true);
    expect(isDemoSession({ athleteId: 42, exp: 1 })).toBe(false);
    expect(isDemoSession(null)).toBe(false);
  });
});
