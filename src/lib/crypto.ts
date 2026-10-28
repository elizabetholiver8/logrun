import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * The key is derived from SESSION_SECRET with a fixed label so the same
 * secret can serve both cookie signing and token encryption without the two
 * keys being identical. Rotating SESSION_SECRET invalidates stored tokens,
 * which forces a re-login; that is the intended behavior.
 *
 * Output format: base64url(iv) . base64url(tag) . base64url(ciphertext)
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(`${secret}:token-encryption`).digest();
}

export function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string, secret: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted payload");
  }
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64url"));
  const key = deriveKey(secret);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
