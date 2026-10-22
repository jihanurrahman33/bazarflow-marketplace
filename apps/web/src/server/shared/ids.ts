import { ObjectId } from "mongodb";
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

export const newId = (): ObjectId => new ObjectId();

export function parseObjectId(value: string, field = "id"): ObjectId {
  if (!/^[0-9a-fA-F]{24}$/.test(value)) {
    throw new AppError("VALIDATION_FAILED", { details: [{ field, code: "INVALID_ID" }] });
  }
  return new ObjectId(value);
}

/** URL-safe random token (opaque secrets, OTPs seeds, etc.). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");
export const hmacHex = (secret: string, s: string): string => createHmac("sha256", secret).update(s).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Human-friendly public order number, e.g. BF-7K3Q9XH2. Uniqueness enforced by index; callers retry on collision. */
export function publicOrderNumber(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `BF-${out}`;
}
