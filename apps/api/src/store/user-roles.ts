/**
 * REVISION-28 X3 — roles por concello (veciña + persoal, etc.).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AuthUser, Role } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";

const MUNI_SWITCH_ROLES: Role[] = ["admin", "staff", "monitor"];

export type LinkedMuniRole = {
  role: Role;
  municipalityId: string;
  municipalityName: string;
  municipalitySlug?: string;
  label: string;
};

export async function grantUserRole(input: {
  userId: string;
  municipalityId: string;
  role: Role;
  clubId?: string | null;
}): Promise<void> {
  const clubId = input.clubId?.trim() || "";
  const db = getDb();
  await db
    .insert(t.userRoles)
    .values({
      userId: input.userId,
      municipalityId: input.municipalityId,
      role: input.role,
      clubId,
      active: true,
    })
    .onConflictDoUpdate({
      target: [
        t.userRoles.userId,
        t.userRoles.municipalityId,
        t.userRoles.role,
        t.userRoles.clubId,
      ],
      set: { active: true },
    });
}

export async function revokeUserRole(input: {
  userId: string;
  municipalityId: string;
  role: Role;
  clubId?: string | null;
}): Promise<void> {
  const clubId = input.clubId?.trim() || "";
  await getDb()
    .update(t.userRoles)
    .set({ active: false })
    .where(
      and(
        eq(t.userRoles.userId, input.userId),
        eq(t.userRoles.municipalityId, input.municipalityId),
        eq(t.userRoles.role, input.role),
        eq(t.userRoles.clubId, clubId),
      ),
    );
}

export async function userHasActiveRole(
  userId: string,
  municipalityId: string,
  role: Role,
  clubId?: string | null,
): Promise<boolean> {
  const clubKey = clubId?.trim() || "";
  const rows = await getDb()
    .select()
    .from(t.userRoles)
    .where(
      and(
        eq(t.userRoles.userId, userId),
        eq(t.userRoles.municipalityId, municipalityId),
        eq(t.userRoles.role, role),
        eq(t.userRoles.clubId, clubKey),
        eq(t.userRoles.active, true),
      ),
    )
    .limit(1);
  return !!rows[0];
}

export async function listLinkedMuniRolesForUser(
  userId: string,
  municipalityId: string,
): Promise<LinkedMuniRole[]> {
  const db = getDb();
  /* REVISION-30 Z1: roles en calquera concello (veciña Exemplo + admin Terceiro). */
  const rows = await db
    .select({
      role: t.userRoles.role,
      municipalityId: t.userRoles.municipalityId,
      name: t.municipalities.name,
      slug: t.municipalities.slug,
    })
    .from(t.userRoles)
    .innerJoin(
      t.municipalities,
      eq(t.municipalities.id, t.userRoles.municipalityId),
    )
    .where(
      and(
        eq(t.userRoles.userId, userId),
        eq(t.userRoles.active, true),
        inArray(t.userRoles.role, MUNI_SWITCH_ROLES),
      ),
    );

  const userRows = await db
    .select({ role: t.users.role, municipalityId: t.users.municipalityId })
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  const homeRole = userRows[0]?.role as Role | undefined;
  const homeMuni = userRows[0]?.municipalityId ?? municipalityId;

  const out: LinkedMuniRole[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const role = r.role as Role;
    if (!MUNI_SWITCH_ROLES.includes(role)) continue;
    /* O rol «casa» no seu concello non sae no conmutador. */
    if (role === homeRole && r.municipalityId === homeMuni) continue;
    const key = `${r.municipalityId}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      role,
      municipalityId: r.municipalityId,
      municipalityName: r.name,
      municipalitySlug: r.slug,
      label:
        role === "admin"
          ? r.name
          : role === "staff" || role === "monitor"
            ? `${r.name} (conserxaría)`
            : r.name,
    });
  }
  return out;
}

/** Roles de persoal activos no concello (lista admin). */
export async function listStaffUserIds(municipalityId: string): Promise<
  Array<{ userId: string; role: Role; active: boolean }>
> {
  const db = getDb();
  const fromRoles = await db
    .select({
      userId: t.userRoles.userId,
      role: t.userRoles.role,
      active: t.userRoles.active,
    })
    .from(t.userRoles)
    .where(
      and(
        eq(t.userRoles.municipalityId, municipalityId),
        inArray(t.userRoles.role, ["staff", "monitor"]),
        eq(t.userRoles.clubId, ""),
      ),
    );
  const legacy = await db
    .select({ id: t.users.id, role: t.users.role, active: t.users.active })
    .from(t.users)
    .where(
      and(
        eq(t.users.municipalityId, municipalityId),
        inArray(t.users.role, ["staff", "monitor"]),
      ),
    );
  const map = new Map<string, { userId: string; role: Role; active: boolean }>();
  for (const r of fromRoles) {
    if (!r.active) continue;
    map.set(r.userId, {
      userId: r.userId,
      role: r.role as Role,
      active: r.active,
    });
  }
  for (const u of legacy) {
    if (!u.active) continue;
    if (!map.has(u.id)) {
      map.set(u.id, {
        userId: u.id,
        role: u.role as Role,
        active: u.active,
      });
    }
  }
  return [...map.values()];
}

export async function enrichUserWithMuniRoles(
  user: AuthUser,
  activeMuniRole?: Role | null,
  activeMunicipalityId?: string | null,
): Promise<AuthUser> {
  const linkedMuniRoles = await listLinkedMuniRolesForUser(
    user.id,
    user.municipalityId,
  );
  const baseRole = (user.baseRole ?? user.role) as Role;
  const base: AuthUser = {
    ...user,
    baseRole,
    linkedMuniRoles,
    activeMuniRole: activeMuniRole ?? null,
  };
  if (activeMuniRole) {
    /* REVISION-55 G10: preferir o concello pedido. */
    const match =
      (activeMunicipalityId
        ? linkedMuniRoles.find(
            (r) =>
              r.role === activeMuniRole &&
              r.municipalityId === activeMunicipalityId,
          )
        : undefined) ??
      linkedMuniRoles.find((r) => r.role === activeMuniRole);
    if (match) {
      return {
        ...base,
        role: activeMuniRole,
        activeMuniRole,
        municipalityId: match.municipalityId,
        municipalitySlug: match.municipalitySlug ?? user.municipalitySlug,
      };
    }
  }
  if (user.activeClubId) {
    return base;
  }
  return base;
}

export async function userCanActAsMuniRole(
  user: AuthUser,
  role: Role,
  municipalityId: string,
): Promise<boolean> {
  if (user.role === "superadmin") return true;
  const base = (user.baseRole ?? user.role) as Role;
  if (
    user.municipalityId === municipalityId &&
    base === role &&
    MUNI_SWITCH_ROLES.includes(role)
  ) {
    return true;
  }
  /* REVISION-30 Z1: admin/staff noutro concello vía user_roles. */
  return userHasActiveRole(user.id, municipalityId, role);
}

/** Sincroniza user_roles desde users (+ club_members). Idempotente. */
export async function backfillUserRoles(): Promise<void> {
  const db = getDb();
  await db.execute(
    sql.raw(`
INSERT INTO user_roles (user_id, municipality_id, role, club_id)
SELECT id, municipality_id, role, COALESCE(club_id, '')
FROM users
ON CONFLICT DO NOTHING
`),
  );
  await db.execute(
    sql.raw(`
INSERT INTO user_roles (user_id, municipality_id, role, club_id)
SELECT cm.user_id, cm.municipality_id, 'club_manager', cm.club_id
FROM club_members cm
WHERE cm.user_id IS NOT NULL
ON CONFLICT DO NOTHING
`),
  );
}
