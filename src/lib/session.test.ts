import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession } from "./session";

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
});
