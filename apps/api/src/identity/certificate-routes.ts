/**
 * Rotas mTLS: /auth/cert/callback (só vía nginx cert.*) e /auth/cert/finish (orixe app).
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { resolvePostLoginPath, type AuthUser, type Role } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapUser } from "../db/mappers.js";
import {
  certAllowDemoCa,
  cookieSecure,
  isCertLoginEnabled,
  isDemoMode,
  requireCertGatewaySecret,
} from "../env.js";
import { certOrigin } from "./cert-origin.js";
import { setSessionCookie } from "./session-cookie.js";
import { createSession } from "./sessions.js";
import {
  CertParseError,
  isDemoIssuer,
  parseClientCert,
  shortCertIssuerLabel,
} from "./certificate.js";
import { assertCertOcspGood } from "./cert-ocsp.js";
import {
  resolveMunicipalitySlugOrThrow,
  resolveNewUserMunicipalityId,
} from "./resolve-muni.js";

const STATE_TTL_MS = 5 * 60 * 1000;
const TICKET_TTL_MS = 60 * 1000;

/** Ticket → issuerCN (TTL curto; evita migrar schema só pola etiqueta da Conta). */
const ticketIssuerCn = new Map<string, string>();

function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function appBase(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export async function startCertificateLogin(input: {
  municipalityId?: string;
  returnTo?: string;
}): Promise<{ redirectUrl: string; state: string }> {
  if (!isCertLoginEnabled()) {
    throw new Error("cert_login_disabled");
  }
  const origin = certOrigin();
  if (!origin) {
    throw new Error("CERT_ORIGIN / CERT_HOST non configurado");
  }
  const municipalityId = await resolveNewUserMunicipalityId({
    municipalityId: input.municipalityId,
    returnTo: input.returnTo,
  });
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  await getDb().insert(t.certLoginStates).values({
    id: state,
    municipalityId,
    returnTo: input.returnTo ?? null,
    expiresAt,
  });
  const url = new URL("/auth/cert/start", origin);
  url.searchParams.set("state", state);
  /* REVISION-50 S5: o state debe ligarse ao navegador (cookie en /auth/login). */
  return { redirectUrl: url.toString(), state };
}

/** Busca ou crea cidadán; o rol sempre sae da BD. */
export async function resolveUserByPersonIdentifier(
  id: { personIdentifier: string; displayName: string },
  municipalityId: string,
): Promise<AuthUser> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.users)
    .where(eq(t.users.personIdentifier, id.personIdentifier))
    .limit(1);
  const existing = rows[0];
  if (existing) {
    if (existing.active === false) {
      throw new CertParseError("conta_desactivada", "Conta desactivada");
    }
    /*
     * Cidadán que entra cun certificado noutro portal: a casa pasa a ese
     * concello (senón o banner «Entraches desde…» queda pegado ao primeiro
     * login, p.ex. Exemplo → Concello Secundario). Admin/staff/club manteñen a casa.
     */
    if (
      existing.role === "citizen" &&
      existing.municipalityId !== municipalityId
    ) {
      await db
        .update(t.users)
        .set({ municipalityId })
        .where(eq(t.users.id, existing.id));
      const { grantUserRole } = await import("../store/user-roles.js");
      await grantUserRole({
        userId: existing.id,
        municipalityId,
        role: "citizen",
      });
      return mapUser({ ...existing, municipalityId });
    }
    return mapUser(existing);
  }
  const user: AuthUser = {
    id: randomUUID(),
    municipalityId,
    role: "citizen",
    displayName: id.displayName,
    personIdentifier: id.personIdentifier,
    locale: "gl",
  };
  await db.insert(t.users).values({
    id: user.id,
    municipalityId: user.municipalityId,
    role: user.role,
    displayName: user.displayName,
    email: null,
    personIdentifier: user.personIdentifier ?? null,
    locale: user.locale,
    active: true,
  });
  const { grantUserRole } = await import("../store/user-roles.js");
  await grantUserRole({
    userId: user.id,
    municipalityId: user.municipalityId,
    role: user.role,
  });
  return user;
}

async function auditCertLogin(opts: {
  municipalityId: string;
  actor: string;
  issuerCN: string;
  serialHex: string;
}): Promise<void> {
  await getDb().insert(t.auditEvents).values({
    id: randomUUID(),
    municipalityId: opts.municipalityId,
    actor: opts.actor,
    action: "login_certificado",
    detail: JSON.stringify({
      issuerCN: opts.issuerCN,
      serialHex: opts.serialHex,
    }),
  });
}

export function certificateRoutes(): Hono {
  const r = new Hono();

  r.get("/auth/cert/callback", async (c) => {
    if (!isCertLoginEnabled()) {
      return c.text("disabled", 404);
    }
    const expected = requireCertGatewaySecret();
    const auth = c.req.header("X-PA-Gateway-Auth") ?? "";
    if (!secretsEqual(auth, expected)) {
      return c.text("unauthorized", 401);
    }
    const verify = c.req.header("X-PA-Cert-Verify") ?? "";
    if (verify !== "SUCCESS") {
      return c.text("verify_failed", 401);
    }
    const stateId = c.req.query("state") ?? "";
    if (!stateId) return c.text("missing_state", 400);

    const db = getDb();
    const consumed = await db
      .delete(t.certLoginStates)
      .where(
        and(
          eq(t.certLoginStates.id, stateId),
          gt(t.certLoginStates.expiresAt, new Date()),
        ),
      )
      .returning();
    const state = consumed[0];
    if (!state) {
      return c.text("bad_state", 400);
    }

    const certHeader = c.req.header("X-PA-Cert") ?? "";
    let identity;
    try {
      identity = parseClientCert(certHeader);
      /* REVISION-26 G3: OCSP na API (Caddy concello non fai ssl_ocsp). */
      assertCertOcspGood(certHeader);
    } catch (e) {
      const code = e instanceof CertParseError ? e.code : "cert_invalido";
      return c.redirect(
        `${appBase()}/acceso?erro=cert&motivo=${encodeURIComponent(code)}`,
      );
    }

    if (
      !isDemoMode() &&
      !certAllowDemoCa() &&
      isDemoIssuer(identity.issuerCN)
    ) {
      return c.text("demo_ca_forbidden", 401);
    }

    let user: AuthUser;
    try {
      user = await resolveUserByPersonIdentifier(identity, state.municipalityId);
    } catch (e) {
      const code = e instanceof CertParseError ? e.code : "erro";
      return c.redirect(
        `${appBase()}/acceso?erro=cert&motivo=${encodeURIComponent(code)}`,
      );
    }

    const ticket = randomBytes(32).toString("base64url");
    await db.insert(t.certLoginTickets).values({
      id: ticket,
      userId: user.id,
      stateId,
      returnTo: state.returnTo,
      expiresAt: new Date(Date.now() + TICKET_TTL_MS),
    });
    ticketIssuerCn.set(ticket, identity.issuerCN);

    await auditCertLogin({
      municipalityId: state.municipalityId,
      actor: user.id,
      issuerCN: identity.issuerCN,
      serialHex: identity.serialHex,
    });

    return c.redirect(
      `${appBase()}/auth/cert/finish?ticket=${encodeURIComponent(ticket)}`,
    );
  });

  r.get("/auth/cert/finish", async (c) => {
    const ticketId = c.req.query("ticket") ?? "";
    const fail = () => c.redirect(`${appBase()}/acceso?erro=cert&motivo=ticket`);
    if (!ticketId) return fail();

    const db = getDb();
    const consumed = await db
      .delete(t.certLoginTickets)
      .where(
        and(
          eq(t.certLoginTickets.id, ticketId),
          gt(t.certLoginTickets.expiresAt, new Date()),
        ),
      )
      .returning();
    const ticket = consumed[0];
    if (!ticket) return fail();

    /* REVISION-50 S5: o ticket só vale no navegador que iniciou o login. */
    const cookieState = getCookie(c, "pa_cert_state") ?? "";
    if (!cookieState || cookieState !== ticket.stateId) return fail();
    deleteCookie(c, "pa_cert_state", { path: "/" });

    const users = await db
      .select()
      .from(t.users)
      .where(eq(t.users.id, ticket.userId))
      .limit(1);
    const row = users[0];
    if (!row || row.active === false) return fail();
    const user = mapUser(row);

    const sessionId = await createSession(user, { authMethod: "certificate" });
    setSessionCookie(c, sessionId);
    // Conta: «Entraches con certificado…» (cookie de sesión, non no git)
    const secure = cookieSecure() ? "; Secure" : "";
    const cookieMax = 14 * 24 * 3600;
    c.header(
      "Set-Cookie",
      `pa_auth_via=certificate; Path=/; Max-Age=${cookieMax}; SameSite=Lax${secure}`,
      { append: true },
    );
    const issuerCn = ticketIssuerCn.get(ticketId);
    ticketIssuerCn.delete(ticketId);
    const issuerLabel = issuerCn ? shortCertIssuerLabel(issuerCn) : null;
    if (issuerLabel) {
      c.header(
        "Set-Cookie",
        `pa_cert_issuer=${encodeURIComponent(issuerLabel)}; Path=/; Max-Age=${cookieMax}; SameSite=Lax${secure}`,
        { append: true },
      );
    }

    let slug: string;
    try {
      slug = await resolveMunicipalitySlugOrThrow(user.municipalityId);
    } catch {
      return c.json({ error: "municipality_required" }, 400);
    }
    const dest = resolvePostLoginPath(
      user.role as Role,
      slug,
      ticket.returnTo ?? undefined,
      user.clubId,
    );
    return c.redirect(dest);
  });

  return r;
}
