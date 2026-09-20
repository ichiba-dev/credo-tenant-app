import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest();
export const bytea = (bytes: Uint8Array) => `\\x${Buffer.from(bytes).toString("hex")}`;
export const shaBytea = (bytes: Uint8Array | string) => bytea(sha256(bytes));

function secret(name: string): Buffer {
  const value = process.env[name];
  if (!value) throw new Error("OUTBOUND_SECRET_UNAVAILABLE");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("OUTBOUND_SECRET_INVALID");
  return key;
}

export function derivePdfToken(attachmentId: string, requestId: string): string {
  return createHmac("sha256", secret("OUTBOUND_TOKEN_SECRET"))
    .update(`pdf:${attachmentId}:${requestId}`).digest("base64url");
}

export function encryptPayload(payload: unknown) {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret("OUTBOUND_PAYLOAD_KEY_V1"), nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  return { ciphertext: bytea(envelope), sha: shaBytea(plaintext) };
}

export function decryptPayload(value: string): unknown {
  const envelope = Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
  if (envelope.length < 29) throw new Error("OUTBOUND_PAYLOAD_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", secret("OUTBOUND_PAYLOAD_KEY_V1"), envelope.subarray(0, 12));
  decipher.setAuthTag(envelope.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]).toString("utf8"));
}

export function digestMatches(stored: string, actual: Uint8Array | string): boolean {
  const a = Buffer.from(stored.startsWith("\\x") ? stored.slice(2) : stored, "hex");
  const b = sha256(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
