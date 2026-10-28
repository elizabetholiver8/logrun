import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

const secret = "test-secret-not-for-production";

describe("token encryption", () => {
  it("round-trips", () => {
    const enc = encrypt("access-token-value", secret);
    expect(enc).not.toContain("access-token-value");
    expect(decrypt(enc, secret)).toBe("access-token-value");
  });

  it("produces a different ciphertext each call", () => {
    expect(encrypt("same", secret)).not.toBe(encrypt("same", secret));
  });

  it("fails with the wrong secret", () => {
    const enc = encrypt("value", secret);
    expect(() => decrypt(enc, "wrong")).toThrow();
  });

  it("fails on a tampered payload", () => {
    const [iv, tag, ct] = encrypt("value", secret).split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() => decrypt(`${iv}.${tag}.${flipped.toString("base64url")}`, secret)).toThrow();
  });
});
