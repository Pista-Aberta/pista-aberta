import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireSessionSecret } from "../env.js";

function secret(): string {
  return requireSessionSecret();
}

/** Código curto lexible (p.ex. PA-7K2M). */
export function makeShortCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(4);
  let out = "PA-";
  for (let i = 0; i < 4; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Payload HMAC: id|date|shortCode. */
export function signQrPayload(bookingId: string, date: string, shortCode: string): string {
  const body = `${bookingId}|${date}|${shortCode}`;
  const sig = createHmac("sha256", secret()).update(body).digest("hex").slice(0, 16);
  return `${body}|${sig}`;
}

export function verifyQrPayload(payload: string): boolean {
  const parts = payload.split("|");
  if (parts.length !== 4) return false;
  const [id, date, shortCode, sig] = parts;
  if (!id || !date || !shortCode || !sig) return false;
  const expected = signQrPayload(id, date, shortCode);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(payload);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
