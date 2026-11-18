import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AuthUser, Role } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapUser } from "../db/mappers.js";
import { isDemoMode } from "../env.js";

const SESSION_DAYS = 14;
const CITIZEN_MAX_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** Persoal: 30 min sen actividade. */
const STAFF_IDLE_MS = 30 * 60 * 1000;
/** Persoal: máximo absoluto 8 h desde createdAt. */
const STAFF_ABSOLUTE_MS = 8 * 60 * 60 * 1000;

const STAFF_ROLES: Role[] = ["admin", "staff", "monitor", "superadmin"];

export function isStaffSessionRole(role: Role | string | undefined): boolean {
  return STAFF_ROLES.includes(role as Role);
}

/**
 * REVISION-23 R9 — TTL segundo o rol.
 * SESSION_MINUTES (tests) ten prioridade absoluta.
 */
export function sessionTtlMs(role?: Role | string): number {
  const minutes = Number(process.env.SESSION_MINUTES ?? "");
  if (Number.isFinite(minutes) && minutes > 0) {
    return minutes * 60 * 1000;
  }
  if (isStaffSessionRole(role)) {
    return STAFF_IDLE_MS;
  }
  return CITIZEN_MAX_MS;
}

/** Máximo absoluto desde createdAt (persoal: 8 h; resto: 14 días). */
export function sessionAbsoluteMaxMs(role?: Role | string): number {
  const minutes = Number(process.env.SESSION_MINUTES ?? "");
  if (Number.isFinite(minutes) && minutes > 0) {
    /* Nos tests o absoluto é 4× o idle para poder comprobar o tope. */
    return minutes * 60 * 1000 * 4;
  }
  if (isStaffSessionRole(role)) {
    return STAFF_ABSOLUTE_MS;
  }
  return CITIZEN_MAX_MS;
}

export { SESSION_DAYS, STAFF_IDLE_MS, STAFF_ABSOLUTE_MS };

async function withMunicipalitySlug(user: AuthUser): Promise<AuthUser> {
  if (user.municipalitySlug) return user;
  const rows = await getDb()
    .select({ slug: t.municipalities.slug })
    .from(t.municipalities)
    .where(eq(t.municipalities.id, user.municipalityId))
    .limit(1);
  return {
    ...user,
    municipalitySlug: rows[0]?.slug,
  };
}

export type SessionAuthMethod = "saml" | "certificate" | "email_otp";

export async function createSession(
  user: AuthUser,
  opts?: { authMethod?: SessionAuthMethod },
): Promise<string> {
  const db = getDb();
  await db
    .insert(t.users)
    .values({
      id: user.id,
      municipalityId: user.municipalityId,
      role: user.role,
      displayName: user.displayName,
      email: user.email ?? null,
      personIdentifier: user.personIdentifier ?? null,
      clubId: user.clubId ?? null,
      locale: user.locale,
      consentAt: user.consentAt ? new Date(user.consentAt) : null,
      consentVersion: user.consentVersion ?? null,
    })
    .onConflictDoUpdate({
      target: t.users.id,
      set: {
        role: user.role,
        displayName: user.displayName,
        email: user.email ?? null,
        personIdentifier: user.personIdentifier ?? null,
        locale: user.locale,
        ...(user.clubId ? { clubId: user.clubId } : {}),
      },
    });

  const id = randomUUID();
  const role = user.baseRole ?? user.role;
  const expiresAt = new Date(Date.now() + sessionTtlMs(role));
  await db.insert(t.sessions).values({
    id,
    userId: user.id,
    expiresAt,
    authMethod: opts?.authMethod ?? null,
  });
  const { grantUserRole } = await import("../store/user-roles.js");
  await grantUserRole({
    userId: user.id,
    municipalityId: user.municipalityId,
    role: user.baseRole ?? user.role,
    clubId: user.clubId,
  }).catch(() => {
    /* backfill / duplicate ok */
  });
  void isDemoMode; /* demo tamén usa 30 min para persoal (R9). */
  return id;
}

export type SessionMeta = {
  user: AuthUser;
  expiresAt: Date;
  createdAt: Date;
  /** REVISION-50 S2 */
  authMethod: SessionAuthMethod | null;
};

const ELEVATED_MUNI_ROLES: Role[] = ["admin", "staff", "monitor", "superadmin"];

async function elevatedBlockedByWeakAuth(
  authMethod: string | null | undefined,
  municipalityId: string,
): Promise<boolean> {
  if (authMethod !== "email_otp") return false;
  const { elevatedRolesRequireSaml, isProduction } = await import("../env.js");
  if (elevatedRolesRequireSaml()) return true;
  const { getMunicipalityById } = await import("../store/db.js");
  const muni = await getMunicipalityById(municipalityId);
  if (muni?.settings.staffStrongAuth === true) return true;
  if (muni?.settings.staffStrongAuth === false) return false;
  return isProduction();
}

export async function getSessionMeta(
  sessionId: string,
): Promise<SessionMeta | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.sessions)
    .where(eq(t.sessions.id, sessionId))
    .limit(1);
  const ses = rows[0];
  if (!ses) return null;
  if (ses.expiresAt.getTime() < Date.now()) {
    await destroySession(sessionId);
    return null;
  }
  const users = await db
    .select()
    .from(t.users)
    .where(eq(t.users.id, ses.userId))
    .limit(1);
  const u = users[0];
  if (!u) return null;
  if (u.active === false) {
    await destroySession(sessionId);
    return null;
  }
  const base = await withMunicipalitySlug(mapUser(u));
  const { enrichUserWithClubs } = await import("../store/club-members.js");
  const { enrichUserWithMuniRoles } = await import("../store/user-roles.js");
  let activeMuniRole = (ses.activeMuniRole as Role | null) ?? null;
  const activeMunicipalityId =
    (ses.activeMunicipalityId as string | null) ?? null;
  /* REVISION-50 S2: OTP non pode manter rol elevado se o concello esixe acceso forte. */
  const elevatedMuni =
    activeMunicipalityId ?? base.municipalityId;
  if (
    activeMuniRole &&
    ELEVATED_MUNI_ROLES.includes(activeMuniRole) &&
    (await elevatedBlockedByWeakAuth(ses.authMethod, elevatedMuni))
  ) {
    await db
      .update(t.sessions)
      .set({ activeMuniRole: null, activeMunicipalityId: null })
      .where(eq(t.sessions.id, sessionId));
    activeMuniRole = null;
  }

  let user = await enrichUserWithClubs(base, ses.activeClubId ?? null);
  user = await enrichUserWithMuniRoles(
    user,
    activeMuniRole,
    activeMunicipalityId,
  );

  const role = user.baseRole ?? user.role;
  const absoluteDeadline =
    ses.createdAt.getTime() + sessionAbsoluteMaxMs(role);
  if (Date.now() > absoluteDeadline) {
    await destroySession(sessionId);
    return null;
  }

  return {
    user,
    expiresAt: ses.expiresAt,
    createdAt: ses.createdAt,
    authMethod: (ses.authMethod as SessionAuthMethod | null) ?? null,
  };
}

export async function getSession(sessionId: string): Promise<AuthUser | null> {
  const meta = await getSessionMeta(sessionId);
  return meta?.user ?? null;
}

/**
 * Extende a caducidade sen pasar do máximo absoluto desde createdAt.
 * REVISION-23 R9.
 */
export async function renewSession(
  sessionId: string,
): Promise<SessionMeta | null> {
  const meta = await getSessionMeta(sessionId);
  if (!meta) return null;
  const role = meta.user.baseRole ?? meta.user.role;
  const absoluteDeadline =
    meta.createdAt.getTime() + sessionAbsoluteMaxMs(role);
  const next = Math.min(Date.now() + sessionTtlMs(role), absoluteDeadline);
  if (next <= Date.now()) {
    await destroySession(sessionId);
    return null;
  }
  const expiresAt = new Date(next);
  await getDb()
    .update(t.sessions)
    .set({ expiresAt })
    .where(eq(t.sessions.id, sessionId));
  return {
    user: meta.user,
    expiresAt,
    createdAt: meta.createdAt,
    authMethod: meta.authMethod,
  };
}

/** REVISION-22 B3 — «Entrar como» club / a miña conta. */
export async function setSessionActiveClub(
  sessionId: string,
  clubId: string | null,
): Promise<AuthUser | null> {
  const meta = await getSessionMeta(sessionId);
  if (!meta) return null;
  if (clubId) {
    const { userCanActAsClub } = await import("../store/club-members.js");
    const ok = await userCanActAsClub(
      { ...meta.user, role: meta.user.baseRole ?? meta.user.role },
      clubId,
      meta.user.municipalityId,
    );
    if (!ok) throw new Error("forbidden");
  }
  await getDb()
    .update(t.sessions)
    .set({
      activeClubId: clubId,
      ...(clubId
        ? { activeMuniRole: null, activeMunicipalityId: null }
        : {}),
    })
    .where(eq(t.sessions.id, sessionId));
  const next = await getSessionMeta(sessionId);
  return next?.user ?? null;
}

/** REVISION-28 X3 — «Entrar como» conserxaría / admin municipal. */
export async function setSessionActiveMuniRole(
  sessionId: string,
  role: Role | null,
  municipalityId?: string | null,
): Promise<AuthUser | null> {
  const meta = await getSessionMeta(sessionId);
  if (!meta) return null;
  let targetMuni: string | null = null;
  if (role) {
    /* Inline: evita ciclo sessions ↔ store en arranque (auth/middleware). */
    const { userCanActAsMuniRole, listLinkedMuniRolesForUser } = await import(
      "../store/user-roles.js"
    );
    const home = meta.user.baseRole
      ? { ...meta.user, role: meta.user.baseRole }
      : meta.user;
    targetMuni = municipalityId ?? null;
    if (!targetMuni) {
      const linked = await listLinkedMuniRolesForUser(
        home.id,
        home.municipalityId,
      );
      const match = linked.find((r) => r.role === role);
      targetMuni = match?.municipalityId ?? home.municipalityId;
    }
    const ok = await userCanActAsMuniRole(home, role, targetMuni);
    if (!ok) throw new Error("forbidden");
    /* REVISION-50 S2: non activar admin/staff/monitor se entrou por OTP débil. */
    if (
      ELEVATED_MUNI_ROLES.includes(role) &&
      (await elevatedBlockedByWeakAuth(meta.authMethod, targetMuni))
    ) {
      throw new Error("forbidden");
    }
  }
  await getDb()
    .update(t.sessions)
    .set({
      activeMuniRole: role,
      activeMunicipalityId: role ? targetMuni : null,
      ...(role ? { activeClubId: null } : {}),
    })
    .where(eq(t.sessions.id, sessionId));
  const next = await getSessionMeta(sessionId);
  return next?.user ?? null;
}

export async function destroySession(sessionId: string): Promise<void> {
  await getDb().delete(t.sessions).where(eq(t.sessions.id, sessionId));
}

/** REVISION-30 Z1 — pechar sesións co papel municipal activo. */
export async function clearSessionsActiveMuniRole(
  userId: string,
  role: Role,
): Promise<void> {
  await getDb()
    .update(t.sessions)
    .set({ activeMuniRole: null })
    .where(
      and(eq(t.sessions.userId, userId), eq(t.sessions.activeMuniRole, role)),
    );
}

export async function resolveUserSlug(user: AuthUser): Promise<string> {
  const enriched = await withMunicipalitySlug(user);
  if (enriched.municipalitySlug) return enriched.municipalitySlug;
  const { resolveMunicipalitySlugOrThrow } = await import("./resolve-muni.js");
  return resolveMunicipalitySlugOrThrow(user.municipalityId);
}
