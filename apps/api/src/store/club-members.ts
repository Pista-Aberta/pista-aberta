/**
 * REVISION-22 B3 — varias persoas responsables por club.
 * Compat: users.clubId + club_manager segue a funcionar.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AuthUser, Club, ClubMember } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapClub, mapClubMember, mapUser } from "../db/mappers.js";
import { toPersonIdentifier } from "../lib/nif.js";
import { effectiveRoleInMunicipality } from "../lib/effective-role.js";
import { audit } from "./extra.js";

export async function listLinkedClubsForUser(
  userId: string,
  municipalityId: string,
): Promise<Array<{ id: string; name: string; shortName: string }>> {
  const db = getDb();
  const memberRows = await db
    .select({
      clubId: t.clubMembers.clubId,
      name: t.clubs.name,
      shortName: t.clubs.shortName,
    })
    .from(t.clubMembers)
    .innerJoin(t.clubs, eq(t.clubs.id, t.clubMembers.clubId))
    .where(
      and(
        eq(t.clubMembers.userId, userId),
        eq(t.clubMembers.municipalityId, municipalityId),
      ),
    );

  const userRows = await db
    .select()
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  const u = userRows[0];
  const out = new Map<string, { id: string; name: string; shortName: string }>();
  for (const r of memberRows) {
    out.set(r.clubId, { id: r.clubId, name: r.name, shortName: r.shortName });
  }
  if (u?.clubId && u.municipalityId === municipalityId) {
    const clubs = await db
      .select()
      .from(t.clubs)
      .where(eq(t.clubs.id, u.clubId))
      .limit(1);
    if (clubs[0]) {
      out.set(clubs[0].id, {
        id: clubs[0].id,
        name: clubs[0].name,
        shortName: clubs[0].shortName,
      });
    }
  }
  return [...out.values()];
}

export async function userCanActAsClub(
  user: AuthUser,
  clubId: string,
  municipalityId: string,
): Promise<boolean> {
  const effective = effectiveRoleInMunicipality(user, municipalityId);
  if (effective === "superadmin") return true;
  if (effective === "admin") return true;
  if (!effective) return false;
  if (user.clubId === clubId && effective === "club_manager") return true;
  if (user.activeClubId === clubId) return true;
  if (user.linkedClubs?.some((c) => c.id === clubId)) return true;
  const rows = await getDb()
    .select()
    .from(t.clubMembers)
    .where(
      and(
        eq(t.clubMembers.clubId, clubId),
        eq(t.clubMembers.userId, user.id),
        eq(t.clubMembers.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  return !!rows[0];
}

/**
 * REVISION-23 R4 — filtra sempre por municipalityId (illamento de tenant).
 * Se o club non pertence ao concello → not_found.
 */
export async function listClubResponsables(
  clubId: string,
  municipalityId: string,
): Promise<ClubMember[]> {
  const db = getDb();
  const clubs = await db
    .select({ id: t.clubs.id })
    .from(t.clubs)
    .where(
      and(eq(t.clubs.id, clubId), eq(t.clubs.municipalityId, municipalityId)),
    )
    .limit(1);
  if (!clubs[0]) throw new Error("not_found");

  const rows = await db
    .select()
    .from(t.clubMembers)
    .where(
      and(
        eq(t.clubMembers.clubId, clubId),
        eq(t.clubMembers.municipalityId, municipalityId),
      ),
    );
  return rows.map(mapClubMember);
}

export async function addClubResponsable(input: {
  municipalityId: string;
  clubId: string;
  userId?: string;
  email?: string;
  displayName?: string;
  nif?: string;
  role?: "manager" | "coach";
  actor: string;
}): Promise<ClubMember> {
  const db = getDb();
  const clubs = await db
    .select()
    .from(t.clubs)
    .where(
      and(
        eq(t.clubs.id, input.clubId),
        eq(t.clubs.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  if (!clubs[0]) throw new Error("not_found");

  let userId = input.userId?.trim() || null;
  let displayName = input.displayName?.trim() || "";
  let email = (input.email ?? "").trim().toLowerCase();
  let personIdentifier: string | null = null;
  if (input.nif?.trim()) {
    try {
      personIdentifier = toPersonIdentifier(input.nif);
    } catch {
      throw new Error("nif_invalid");
    }
  }

  if (personIdentifier && !userId) {
    const byNif = await db
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, personIdentifier))
      .limit(1);
    if (byNif[0]) {
      if (byNif[0].municipalityId !== input.municipalityId) {
        throw new Error("nif_other_muni");
      }
      userId = byNif[0].id;
      displayName = displayName || byNif[0].displayName;
      email = email || (byNif[0].email ?? "").toLowerCase();
    }
  }

  if (userId) {
    const users = await db
      .select()
      .from(t.users)
      .where(eq(t.users.id, userId))
      .limit(1);
    const u = users[0];
    if (!u || u.municipalityId !== input.municipalityId) {
      throw new Error("user_not_found");
    }
    displayName = displayName || u.displayName;
    email = email || (u.email ?? "").toLowerCase();
    if (personIdentifier) {
      await db
        .update(t.users)
        .set({ personIdentifier })
        .where(eq(t.users.id, u.id));
    }
  } else if (email) {
    const users = await db
      .select()
      .from(t.users)
      .where(
        and(
          eq(t.users.email, email),
          eq(t.users.municipalityId, input.municipalityId),
        ),
      )
      .limit(1);
    if (users[0]) {
      userId = users[0].id;
      displayName = displayName || users[0].displayName;
      if (personIdentifier) {
        await db
          .update(t.users)
          .set({ personIdentifier })
          .where(eq(t.users.id, users[0].id));
      }
    } else if (personIdentifier) {
      /* REVISION-26 G1: crea conta club co NIF para o primeiro login. */
      const newId = `club-user-${randomUUID().slice(0, 8)}`;
      await db.insert(t.users).values({
        id: newId,
        municipalityId: input.municipalityId,
        role: "club_manager",
        displayName: displayName || email.split("@")[0] || "Responsable",
        email,
        personIdentifier,
        clubId: input.clubId,
        locale: "gl",
        active: true,
      });
      userId = newId;
      displayName = displayName || email.split("@")[0] || "Responsable";
    }
  }
  if (!email) throw new Error("email_required");
  if (!displayName) displayName = email.split("@")[0] || "Responsable";

  if (userId) {
    const dup = await db
      .select()
      .from(t.clubMembers)
      .where(
        and(
          eq(t.clubMembers.clubId, input.clubId),
          eq(t.clubMembers.userId, userId),
        ),
      )
      .limit(1);
    if (dup[0]) throw new Error("already_member");
  }

  if (userId) {
    const { grantUserRole } = await import("./user-roles.js");
    await grantUserRole({
      userId,
      municipalityId: input.municipalityId,
      role: "club_manager",
      clubId: input.clubId,
    });
  }

  const id = `cm-${randomUUID().slice(0, 10)}`;
  const role = input.role ?? "manager";
  await db.insert(t.clubMembers).values({
    id,
    clubId: input.clubId,
    municipalityId: input.municipalityId,
    displayName,
    email,
    role,
    userId,
  });

  await audit(
    input.municipalityId,
    input.actor,
    "club.responsable.add",
    `Engadiu responsable ${displayName} <${email}> ao club ${clubs[0].name}`,
  );

  return {
    id,
    clubId: input.clubId,
    municipalityId: input.municipalityId,
    displayName,
    email,
    role,
    userId,
  };
}

export async function removeClubResponsable(input: {
  municipalityId: string;
  clubId: string;
  memberId: string;
  actor: string;
}): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.clubMembers)
    .where(
      and(
        eq(t.clubMembers.id, input.memberId),
        eq(t.clubMembers.clubId, input.clubId),
        eq(t.clubMembers.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  const m = rows[0];
  if (!m) throw new Error("not_found");
  await db.delete(t.clubMembers).where(eq(t.clubMembers.id, input.memberId));
  await audit(
    input.municipalityId,
    input.actor,
    "club.responsable.remove",
    `Retirou responsable ${m.displayName} <${m.email}> do club ${input.clubId}`,
  );
}

export async function updateClubEntity(
  municipalityId: string,
  clubId: string,
  patch: Partial<Pick<Club, "name" | "shortName" | "cif" | "sport" | "email">>,
): Promise<Club> {
  const db = getDb();
  const set: Record<string, string | null> = {};
  if (patch.name?.trim()) set.name = patch.name.trim();
  if (patch.shortName?.trim()) set.shortName = patch.shortName.trim().slice(0, 32);
  if (patch.cif !== undefined) set.cif = patch.cif?.trim() || null;
  if (patch.sport !== undefined) set.sport = patch.sport?.trim() || null;
  if (patch.email !== undefined) {
    set.email = patch.email?.trim().toLowerCase() || null;
  }
  if (Object.keys(set).length) {
    await db
      .update(t.clubs)
      .set(set)
      .where(
        and(eq(t.clubs.id, clubId), eq(t.clubs.municipalityId, municipalityId)),
      );
  }
  const rows = await db
    .select()
    .from(t.clubs)
    .where(eq(t.clubs.id, clubId))
    .limit(1);
  if (!rows[0]) throw new Error("not_found");
  return mapClub(rows[0]);
}

/** Enrich AuthUser with linkedClubs; optionally apply activeClubId overlay. */
export async function enrichUserWithClubs(
  user: AuthUser,
  activeClubId?: string | null,
): Promise<AuthUser> {
  const linked = await listLinkedClubsForUser(user.id, user.municipalityId);
  const base: AuthUser = {
    ...user,
    baseRole: user.baseRole ?? user.role,
    linkedClubs: linked,
    activeClubId: activeClubId ?? null,
  };
  if (activeClubId && linked.some((c) => c.id === activeClubId)) {
    return {
      ...base,
      role: "club_manager",
      clubId: activeClubId,
      activeClubId,
    };
  }
  return base;
}

export { mapUser, isNotNull };
