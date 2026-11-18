/**
 * Límite de intentos de login (correo / Cl@ve / inicio de certificado).
 * Reutiliza otp_rate_limits cunha clave prefixada para non mesturar cos envíos OTP.
 *
 * REVISION-16 N1:
 * - Inicio SAML (sen identifier) → límite por IP.
 * - Demo (PA_DEMO): tope alto no inicio Cl@ve por IP; o límite serio vai no correo.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { isDemoMode, isTrustProxy } from "../env.js";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS_DEFAULT = 10;
/** REVISION-60 M5: máximo de envíos OTP por IP en 10 min (ademais do límite por correo). */
const MAX_HITS_OTP_IP = 20;
/** REVISION-61: en modo demo (wifi compartida polo xurado/público), límite amplo por IP. */
const MAX_HITS_DEMO_OTP_IP = 200;
/** Demo: moitos perfiles Cl@ve sen bloquear o xurado. */
const MAX_HITS_DEMO_SAML_IP = 60;

export class LoginRateLimitedError extends Error {
  readonly code = "rate_limited" as const;
  readonly retryAfterMinutes: number;

  constructor(retryAfterMinutes: number) {
    super("rate_limited");
    this.name = "LoginRateLimitedError";
    this.retryAfterMinutes = Math.max(1, retryAfterMinutes);
  }
}

export type LoginRateLimitKind = "default" | "saml_start" | "otp_ip";

export function maxHitsFor(kind: LoginRateLimitKind = "default"): number {
  switch (kind) {
    case "saml_start":
      return isDemoMode() ? MAX_HITS_DEMO_SAML_IP : MAX_HITS_DEFAULT;
    case "otp_ip":
      return isDemoMode() ? MAX_HITS_DEMO_OTP_IP : MAX_HITS_OTP_IP;
    case "default":
      return MAX_HITS_DEFAULT;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * REVISION-60 M3:
 * Ignorar X-Forwarded-For / X-Real-IP salvo TRUST_PROXY=1.
 * Con TRUST_PROXY=1: último salto de X-Forwarded-For (engadido polo proxy propio),
 * con fallback a X-Real-IP.
 */
export function clientIpFromHeaders(
  headers: {
    get(name: string): string | undefined;
  },
  opts?: {
    trustProxy?: boolean;
    remoteAddress?: string;
  },
): string {
  const trust = opts?.trustProxy ?? isTrustProxy();
  if (trust) {
    const xff = headers.get("x-forwarded-for");
    if (xff) {
      const parts = xff
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1]!;
    }
    const real = headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  const sock = opts?.remoteAddress?.trim();
  return sock || "unknown";
}

export function clientIpFromContext(c: {
  req: { header(name: string): string | undefined };
  env?: unknown;
}): string {
  const incoming = (
    c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  )?.incoming;
  return clientIpFromHeaders(
    { get: (name) => c.req.header(name) },
    { remoteAddress: incoming?.socket?.remoteAddress },
  );
}

/** Engade ?login= sen romper query existentes (REVISION-16 N2). */
export function withLoginParam(
  appBaseUrl: string,
  destPath: string,
  login: string,
): string {
  const base = appBaseUrl.endsWith("/") ? appBaseUrl : `${appBaseUrl}/`;
  const url = new URL(destPath.startsWith("/") ? destPath : `/${destPath}`, base);
  url.searchParams.set("login", login);
  return url.toString();
}

async function assertPrefixedRateLimit(opts: {
  key: string;
  maxHits: number;
  windowMs: number;
}): Promise<void> {
  const email = opts.key.trim().toLowerCase() || "anonymous";
  const now = Date.now();
  const db = getDb();
  const rows = await db
    .select()
    .from(t.otpRateLimits)
    .where(eq(t.otpRateLimits.email, email))
    .limit(1);
  const prev = ((rows[0]?.hits as number[] | undefined) ?? []).filter(
    (ts) => now - ts < opts.windowMs,
  );
  if (prev.length >= opts.maxHits) {
    const oldest = Math.min(...prev);
    const retryAfterMinutes = Math.ceil(
      (oldest + opts.windowMs - now) / 60_000,
    );
    throw new LoginRateLimitedError(retryAfterMinutes);
  }
  prev.push(now);
  if (rows[0]) {
    await db
      .update(t.otpRateLimits)
      .set({ hits: prev, updatedAt: new Date() })
      .where(eq(t.otpRateLimits.email, email));
  } else {
    await db.insert(t.otpRateLimits).values({
      email,
      hits: prev,
      updatedAt: new Date(),
    });
  }
}

export async function assertLoginRateLimit(
  key: string,
  kind: LoginRateLimitKind = "default",
): Promise<void> {
  await assertPrefixedRateLimit({
    key: `login:${key.trim().toLowerCase() || "anonymous"}`,
    maxHits: maxHitsFor(kind),
    windowMs: WINDOW_MS,
  });
}

const EMAIL_CHANGE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_CHANGE_MAX_PER_USER = 5;
const EMAIL_CHANGE_MAX_PER_DEST = 3;

/**
 * REVISION-51 B3 — cambio de correo: 5/hora/persoa e 3/hora/correo destino.
 * Mesmo almacén có código de acceso (`otp_rate_limits`).
 */
export async function assertEmailChangeRateLimit(
  userId: string,
  destinationEmail: string,
): Promise<void> {
  const dest = destinationEmail.trim().toLowerCase();
  await assertPrefixedRateLimit({
    key: `email_change:user:${userId.trim() || "anonymous"}`,
    maxHits: EMAIL_CHANGE_MAX_PER_USER,
    windowMs: EMAIL_CHANGE_WINDOW_MS,
  });
  await assertPrefixedRateLimit({
    key: `email_change:dest:${dest || "anonymous"}`,
    maxHits: EMAIL_CHANGE_MAX_PER_DEST,
    windowMs: EMAIL_CHANGE_WINDOW_MS,
  });
}
