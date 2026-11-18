import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AuthUser, Role } from "@pista-aberta/shared";
import type {
  CallbackInput,
  IdentityProvider,
  LoginStartInput,
  LoginStartResult,
} from "./types.js";
import { createSession, destroySession, getSession } from "./sessions.js";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapUser } from "../db/mappers.js";
import { elevatedRolesRequireSaml, isProduction } from "../env.js";
import { getMunicipalityById } from "../store/db.js";
import { resolveNewUserMunicipalityId } from "./resolve-muni.js";
/** PA_DEMO explícito (non isDemoMode: development/test non deben filtrar o código). */
function isExplicitPaDemo(): boolean {
  return process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true";
}

/** Persoal municipal: require Cl@ve/cert (non OTP). Clubs e veciñanza OK. */
const STAFF_ROLES: Role[] = ["admin", "superadmin", "staff", "monitor"];

async function staffStrongAuthRequired(municipalityId: string): Promise<boolean> {
  if (elevatedRolesRequireSaml()) return true;
  const muni = await getMunicipalityById(municipalityId);
  if (muni?.settings.staffStrongAuth === true) return true;
  if (muni?.settings.staffStrongAuth === false) return false;
  return isProduction();
}

export class StrongAuthRequiredError extends Error {
  readonly code = "strong_auth_required";
  constructor() {
    super("strong_auth_required");
    this.name = "StrongAuthRequiredError";
  }
}

/**
 * AVISOS-E-CORREO §1.2 + REVISION-22 A9:
 * - Con SMTP: envía o correo; nunca pon o código nos logs.
 * - Sen SMTP en produción / PA_DEMO=0: erro sen filtrar o código.
 * - Sen SMTP só en PA_DEMO=1 (ou NODE_ENV non-prod legado): o código vai
 *   na resposta (demoCode), non nos logs.
 */
/**
 * REVISION-23 R3 — mesmo transporte SMTP que notify/mail.ts (auth + secure:465).
 * Non usa List-Unsubscribe (correo transaccional de autenticación).
 */
async function deliverOtp(
  email: string,
  code: string,
  municipalityId?: string | null,
): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 1025);
  const prod = process.env.NODE_ENV === "production";
  const paDemo = isExplicitPaDemo();
  if (host) {
    const { sendRenderedMail } = await import("../notify/send-notice.js");
    /* REVISION-34 E8: marca do concello se hai municipalityId. */
    const muni = municipalityId
      ? ((await getMunicipalityById(municipalityId)) ?? null)
      : null;
    const ok = await sendRenderedMail({
      to: email,
      muni,
      locale: "gl",
      kind: "otp",
      data: { code },
    });
    if (ok) {
      console.info(`[email-otp] enviado a ${email} vía ${host}:${port}`);
      return;
    }
    console.warn(`[email-otp] SMTP fallou para ${email}`);
    if (prod || !paDemo) {
      throw new Error(
        "Non se puido enviar o código; téntao de novo ou usa Cl@ve/certificado",
      );
    }
    // Demo sen SMTP operativo: o código amósase en pantalla (demoCode).
    return;
  }
  if (prod) {
    console.warn(`[email-otp] SMTP_HOST ausente en produción; non se envía a ${email}`);
    throw new Error(
      "Non se puido enviar o código; téntao de novo ou usa Cl@ve/certificado",
    );
  }
  /* Dev/test/demo sen SMTP: o código vive no desafío (e en demoCode se PA_DEMO=1).
   * Nunca imprimimos as cifras — A9: con PA_DEMO=0 non existen nos logs. */
  if (paDemo) {
    console.info(`[email-otp] demo: código xerado para ${email} (amosar en pantalla)`);
  } else {
    console.info(`[email-otp] código xerado para ${email} (sen SMTP; valor non rexistrado)`);
  }
}

function otpCodesEqual(stored: string, provided: string): boolean {
  const a = Buffer.from(String(stored), "utf8");
  const b = Buffer.from(String(provided), "utf8");
  if (a.length !== b.length) {
    // Comparación dummy para non filtrar lonxitude de forma trivial.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Rate limit OTP por correo en DB: máx. 5 envíos en 10 min. */
async function assertOtpRateLimit(email: string): Promise<void> {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const db = getDb();
  const rows = await db
    .select()
    .from(t.otpRateLimits)
    .where(eq(t.otpRateLimits.email, email))
    .limit(1);
  const prev = ((rows[0]?.hits as number[] | undefined) ?? []).filter(
    (ts) => now - ts < windowMs,
  );
  if (prev.length >= 5) {
    throw new Error("Demasiados códigos. Agarda uns minutos.");
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

/**
 * Fallback correo + OTP. Cidadáns e contas demo.
 * Roles elevados en prod: só SAML (AUTH_ELEVATED_SAML_ONLY / NODE_ENV=production).
 */
export class EmailOtpIdentityProvider implements IdentityProvider {
  async login(input: LoginStartInput): Promise<LoginStartResult> {
    const email = (input.identifier ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("Email inválido");
    }
    await assertOtpRateLimit(email);

    {
      const known = await getDb()
        .select()
        .from(t.users)
        .where(eq(t.users.email, email))
        .limit(1);
      if (
        known[0] &&
        STAFF_ROLES.includes(known[0].role as Role) &&
        (await staffStrongAuthRequired(known[0].municipalityId))
      ) {
        throw new StrongAuthRequiredError();
      }
    }

    const code = String(randomInt(100000, 999999));
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const municipalityId = await resolveNewUserMunicipalityId({
      municipalityId: input.municipalityId,
      returnTo: input.returnTo,
    });
    await getDb().insert(t.otpChallenges).values({
      id: challengeId,
      email,
      code,
      municipalityId,
      attempts: 0,
      expiresAt,
    });
    await deliverOtp(email, code, municipalityId);
    if (isExplicitPaDemo()) {
      return {
        challengeId,
        /* REVISION-34 E8: a demo si envía a Mailpit; o código tamén vai abaixo. */
        message:
          "Na demo o código está abaixo e tamén na bandexa.",
        demoCode: code,
      };
    }
    return {
      challengeId,
      message: "Código enviado ao teu correo. Caduca en 10 minutos.",
    };
  }

  async callback(input: CallbackInput): Promise<AuthUser> {
    const challengeId = input.payload.challengeId;
    const code = input.payload.code;
    if (!challengeId) throw new Error("Desafío OTP caducado ou inexistente");
    const rows = await getDb()
      .select()
      .from(t.otpChallenges)
      .where(eq(t.otpChallenges.id, challengeId))
      .limit(1);
    const ch = rows[0];
    if (!ch || ch.expiresAt.getTime() < Date.now()) {
      if (ch) {
        await getDb().delete(t.otpChallenges).where(eq(t.otpChallenges.id, challengeId));
      }
      throw new Error("Desafío OTP caducado ou inexistente");
    }

    if (!otpCodesEqual(ch.code, code ?? "")) {
      const next = (ch.attempts ?? 0) + 1;
      if (next >= 5) {
        await getDb().delete(t.otpChallenges).where(eq(t.otpChallenges.id, challengeId));
        throw new Error("Código incorrecto. Demasiados intentos: solicite un novo código.");
      }
      await getDb()
        .update(t.otpChallenges)
        .set({ attempts: next })
        .where(eq(t.otpChallenges.id, challengeId));
      throw new Error(`Código incorrecto (${next}/5)`);
    }

    await getDb().delete(t.otpChallenges).where(eq(t.otpChallenges.id, challengeId));

    const known = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.email, ch.email))
      .limit(1);
    if (known[0]) {
      if (known[0].active === false) {
        throw new Error("Conta desactivada. Contacta co concello.");
      }
      if (
        STAFF_ROLES.includes(known[0].role as Role) &&
        (await staffStrongAuthRequired(known[0].municipalityId))
      ) {
        throw new StrongAuthRequiredError();
      }
      return mapUser(known[0]);
    }

    // Conta nova: sempre cidadán (nunca admin por email).
    return {
      id: `otp-${ch.email}`,
      municipalityId: ch.municipalityId,
      role: "citizen",
      displayName: ch.email.split("@")[0] ?? ch.email,
      email: ch.email,
      locale: "gl",
    };
  }

  async logout(sessionId: string): Promise<void> {
    await destroySession(sessionId);
  }

  async getUser(sessionId: string): Promise<AuthUser | null> {
    return getSession(sessionId);
  }
}

export { createSession };
