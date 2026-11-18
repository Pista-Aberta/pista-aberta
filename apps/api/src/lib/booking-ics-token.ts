/**
 * REVISION-35 G7 — token asinado para descargar o .ics dunha reserva sen sesión.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireSessionSecret } from "../env.js";

function secret(): string {
  return requireSessionSecret();
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

/** Token: base64url(bookingId).base64url(sig16). */
export function signBookingIcsToken(bookingId: string): string {
  const payload = b64url(bookingId);
  const sig = createHmac("sha256", secret())
    .update(`booking-ics:${bookingId}`)
    .digest()
    .subarray(0, 16);
  return `${payload}.${b64url(sig)}`;
}

export function verifyBookingIcsToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sigPart] = parts;
  if (!payload || !sigPart) return null;
  let bookingId: string;
  try {
    bookingId = fromB64url(payload).toString("utf8");
  } catch {
    return null;
  }
  if (!bookingId || bookingId.length > 120) return null;
  const expected = createHmac("sha256", secret())
    .update(`booking-ics:${bookingId}`)
    .digest()
    .subarray(0, 16);
  let got: Buffer;
  try {
    got = fromB64url(sigPart);
  } catch {
    return null;
  }
  if (got.length !== expected.length) return null;
  if (!timingSafeEqual(got, expected)) return null;
  return bookingId;
}
