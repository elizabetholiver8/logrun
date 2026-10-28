import { describe, expect, it } from "vitest";
import { hasRequiredScopes, parseRateLimit } from "./strava";

describe("parseRateLimit", () => {
  it("prefers the read-only headers", () => {
    const h = new Headers({
      "x-ratelimit-limit": "400,4000",
      "x-ratelimit-usage": "10,20",
      "x-readratelimit-limit": "200,2000",
      "x-readratelimit-usage": "5,8",
    });
    expect(parseRateLimit(h)).toEqual({ shortUsage: 5, shortLimit: 200, dailyUsage: 8, dailyLimit: 2000 });
  });
  it("falls back to overall headers", () => {
    const h = new Headers({ "x-ratelimit-limit": "400,4000", "x-ratelimit-usage": "10,20" });
    expect(parseRateLimit(h)).toEqual({ shortUsage: 10, shortLimit: 400, dailyUsage: 20, dailyLimit: 4000 });
  });
  it("returns null when headers are absent or malformed", () => {
    expect(parseRateLimit(new Headers())).toBeNull();
    expect(parseRateLimit(new Headers({ "x-ratelimit-limit": "abc", "x-ratelimit-usage": "1,2" }))).toBeNull();
  });
});

describe("hasRequiredScopes", () => {
  it("accepts read plus activity:read_all", () => {
    expect(hasRequiredScopes("read,activity:read_all")).toBe(true);
  });
  it("rejects a consent where activity access was unticked", () => {
    expect(hasRequiredScopes("read")).toBe(false);
    expect(hasRequiredScopes(null)).toBe(false);
  });
});
