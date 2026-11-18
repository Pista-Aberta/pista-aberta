/**
 * Modelo Pablo: 1 conta por club, creada polo admin do concello.
 * Sen «persoas con acceso» múltiples.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AuthUser, Club } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapClub, mapUser } from "../db/mappers.js";
import { effectiveRoleInMunicipality } from "../lib/effective-role.js";

export type ClubAccountRow = Club & {
  account: (AuthUser & { active: boolean }) | null;
};

function slugifyShort(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

export async function listClubAccounts(
  municipalityId: string,
): Promise<ClubAccountRow[]> {
  const db = getDb();
  const clubs = await db
    .select()
    .from(t.clubs)
    .where(eq(t.clubs.municipalityId, municipalityId));
  const managers = await db
    .select()
    .from(t.users)
    .where(
      and(
        eq(t.users.municipalityId, municipalityId),
        eq(t.users.role, "club_manager"),
      ),
    );
  return clubs.map((cl: (typeof clubs)[number]) => {
    const acc = managers.find((u: (typeof managers)[number]) => u.clubId === cl.id);
    return {
      ...mapClub(cl),
      account: acc ? { ...mapUser(acc), active: acc.active } : null,
    };
  });
}

export async function createClubWithAccount(input: {
  municipalityId: string;
  name: string;
  shortName?: string;
  accountEmail: string;
  accountDisplayName?: string;
  cif?: string;
  sport?: string;
  email?: string;
}): Promise<ClubAccountRow> {
  const email = input.accountEmail.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("email_invalid");
  const name = input.name.trim();
  if (!name) throw new Error("name_required");
  const shortName =
    (input.shortName?.trim() || slugifyShort(name) || "club").slice(0, 32);
  const displayName =
    input.accountDisplayName?.trim() || name;

  const db = getDb();
  const existingEmail = await db
    .select()
    .from(t.users)
    .where(eq(t.users.email, email))
    .limit(1);
  if (existingEmail[0]) {
    const ex = existingEmail[0];
    if (ex.municipalityId !== input.municipalityId) {
      throw new Error("email_other_muni");
    }
    if (ex.role === "club_manager" && ex.clubId) {
      throw new Error("email_already_club");
    }
    throw new Error("email_taken");
  }

  const clubId = `club-${slugifyShort(name) || randomUUID().slice(0, 8)}-${randomUUID().slice(0, 4)}`;
  const [clubRow] = await db
    .insert(t.clubs)
    .values({
      id: clubId,
      municipalityId: input.municipalityId,
      name,
      shortName,
      cif: input.cif?.trim() || null,
      sport: input.sport?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
    })
    .returning();

  const userId = `club-user-${randomUUID().slice(0, 8)}`;
  const [userRow] = await db
    .insert(t.users)
    .values({
      id: userId,
      municipalityId: input.municipalityId,
      role: "club_manager",
      displayName,
      email,
      clubId,
      locale: "gl",
      active: true,
    })
    .returning();

  return {
    ...mapClub(clubRow!),
    account: { ...mapUser(userRow!), active: true },
  };
}

/** A conta do club só pode operar o seu clubId neste concello.
 * REVISION-22 B3: tamén activeClubId / linkedClubs.
 * Admin vía user_roles noutro concello conta como admin efectivo. */
export function clubAccountOwnsClub(
  user: AuthUser,
  clubId: string,
  municipalityId: string,
): boolean {
  const effective = effectiveRoleInMunicipality(user, municipalityId);
  if (effective === "superadmin" || effective === "admin") return true;
  if (!effective) return false;
  if (user.activeClubId === clubId) return true;
  if (user.linkedClubs?.some((c) => c.id === clubId)) return true;
  if (effective !== "club_manager") return false;
  return user.clubId === clubId;
}

export async function updateClubAccount(
  municipalityId: string,
  clubId: string,
  patch: {
    name?: string;
    shortName?: string;
    active?: boolean;
    reinviteEmail?: string;
  },
): Promise<ClubAccountRow> {
  const db = getDb();
  const clubs = await db
    .select()
    .from(t.clubs)
    .where(
      and(eq(t.clubs.id, clubId), eq(t.clubs.municipalityId, municipalityId)),
    )
    .limit(1);
  if (!clubs[0]) throw new Error("not_found");

  const clubSet: { name?: string; shortName?: string } = {};
  if (patch.name?.trim()) clubSet.name = patch.name.trim();
  if (patch.shortName?.trim()) clubSet.shortName = patch.shortName.trim().slice(0, 32);
  if (Object.keys(clubSet).length) {
    await db.update(t.clubs).set(clubSet).where(eq(t.clubs.id, clubId));
  }

  const managers = await db
    .select()
    .from(t.users)
    .where(
      and(
        eq(t.users.municipalityId, municipalityId),
        eq(t.users.role, "club_manager"),
        eq(t.users.clubId, clubId),
      ),
    )
    .limit(1);
  const acc = managers[0];
  if (acc) {
    const userSet: { active?: boolean; email?: string; displayName?: string } =
      {};
    if (patch.active !== undefined) userSet.active = patch.active;
    if (patch.reinviteEmail?.trim()) {
      const email = patch.reinviteEmail.trim().toLowerCase();
      if (!email.includes("@")) throw new Error("email_invalid");
      userSet.email = email;
      userSet.active = true;
    }
    if (Object.keys(userSet).length) {
      await db.update(t.users).set(userSet).where(eq(t.users.id, acc.id));
    }
  } else if (patch.reinviteEmail?.trim()) {
    const email = patch.reinviteEmail.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("email_invalid");
    const club = (await db.select().from(t.clubs).where(eq(t.clubs.id, clubId)).limit(1))[0]!;
    await db.insert(t.users).values({
      id: `club-user-${randomUUID().slice(0, 8)}`,
      municipalityId,
      role: "club_manager",
      displayName: club.name,
      email,
      clubId,
      locale: "gl",
      active: true,
    });
  }

  const rows = await listClubAccounts(municipalityId);
  const row = rows.find((r) => r.id === clubId);
  if (!row) throw new Error("not_found");
  return row;
}
