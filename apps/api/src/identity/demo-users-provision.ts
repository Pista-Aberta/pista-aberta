import { and, eq, isNull } from "drizzle-orm";
import type { AuthUser, Role } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import { mapUser } from "../db/mappers.js";
import * as t from "../db/schema.js";
import { addClubResponsable } from "../store/club-members.js";
import { getMunicipalityBySlug, listClubs } from "../store/db.js";
import {
  DEPUTACION_DEMO_ORG_ID,
  DEPUTACION_PLATFORM_MUNI_ID,
  ensureDemoDeputacionEntity,
} from "../store/deputacion-org.js";
import { grantUserRole } from "../store/user-roles.js";
import {
  getLoadedDemoFileUsers,
  type LoadedDemoFileUser,
} from "./demo-users-file.js";

export class DemoMunicipalityNotCreatedError extends Error {
  readonly code = "concello_non_creado" as const;
  readonly municipalitySlug: string;

  constructor(municipalitySlug: string) {
    super("concello_non_creado");
    this.name = "DemoMunicipalityNotCreatedError";
    this.municipalitySlug = municipalitySlug;
  }
}

export type DemoLoginWarning = "club_non_creado";

export type DemoProvisionResult = {
  user: AuthUser;
  warning?: DemoLoginWarning;
  activateClubId?: string;
  activateMuniRole?: { role: Role; municipalityId: string };
};

export function normalizeClubLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

async function upsertUserRecord(params: {
  preferredId: string;
  municipalityId: string;
  organizationId: string | null;
  role: Role;
  displayName: string;
  email: string;
  personIdentifier: string;
  clubId: string | null;
}): Promise<typeof t.users.$inferSelect> {
  const db = getDb();
  const byPi = await db
    .select()
    .from(t.users)
    .where(eq(t.users.personIdentifier, params.personIdentifier))
    .limit(1);
  let existing = byPi[0];

  if (!existing) {
    const byEmail = await db
      .select()
      .from(t.users)
      .where(eq(t.users.email, params.email))
      .limit(1);
    existing = byEmail[0];
  }

  const userId = existing?.id ?? params.preferredId;
  if (existing) {
    await db
      .update(t.users)
      .set({
        municipalityId: params.municipalityId,
        organizationId: params.organizationId,
        role: params.role,
        displayName: params.displayName,
        email: params.email,
        personIdentifier: params.personIdentifier,
        clubId: params.clubId,
        active: true,
      })
      .where(eq(t.users.id, userId));
  } else {
    await db
      .insert(t.users)
      .values({
        id: userId,
        municipalityId: params.municipalityId,
        organizationId: params.organizationId,
        role: params.role,
        displayName: params.displayName,
        email: params.email,
        personIdentifier: params.personIdentifier,
        clubId: params.clubId,
        locale: "gl",
        active: true,
      })
      .onConflictDoUpdate({
        target: t.users.id,
        set: {
          municipalityId: params.municipalityId,
          organizationId: params.organizationId,
          role: params.role,
          displayName: params.displayName,
          email: params.email,
          personIdentifier: params.personIdentifier,
          clubId: params.clubId,
          active: true,
        },
      });
  }

  const rows = await db
    .select()
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  return rows[0]!;
}

async function markMatchingInvitationsUsed(
  municipalityId: string,
  role: "admin" | "staff",
  personIdentifier: string,
  email: string,
): Promise<void> {
  const db = getDb();
  const pending = await db
    .select()
    .from(t.invitations)
    .where(
      and(
        eq(t.invitations.municipalityId, municipalityId),
        eq(t.invitations.role, role),
        isNull(t.invitations.usedAt),
      ),
    );
  const now = new Date();
  for (const inv of pending) {
    const samePi = inv.personIdentifier === personIdentifier;
    const sameEmail = (inv.email ?? "").trim().toLowerCase() === email;
    if (samePi || sameEmail) {
      await db
        .update(t.invitations)
        .set({ usedAt: now })
        .where(eq(t.invitations.id, inv.id));
    }
  }
}

export async function provisionDemoFileUserOnLogin(
  entry: LoadedDemoFileUser,
): Promise<DemoProvisionResult> {
  switch (entry.role) {
    case "deputacion": {
      await ensureDemoDeputacionEntity();
      const row = await upsertUserRecord({
        preferredId: entry.id,
        municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
        organizationId: DEPUTACION_DEMO_ORG_ID,
        role: "superadmin",
        displayName: entry.displayName,
        email: entry.email,
        personIdentifier: entry.personIdentifier,
        clubId: null,
      });
      await grantUserRole({
        userId: row.id,
        municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
        role: "superadmin",
      });
      return {
        user: {
          ...mapUser(row),
          organizationId: DEPUTACION_DEMO_ORG_ID,
        },
      };
    }

    case "vecino": {
      const slug = entry.municipalitySlug!;
      const muni = await getMunicipalityBySlug(slug);
      if (!muni || muni.settings.deputacionPlatform) {
        throw new DemoMunicipalityNotCreatedError(slug);
      }
      const row = await upsertUserRecord({
        preferredId: entry.id,
        municipalityId: muni.id,
        organizationId: null,
        role: "citizen",
        displayName: entry.displayName,
        email: entry.email,
        personIdentifier: entry.personIdentifier,
        clubId: null,
      });
      await grantUserRole({
        userId: row.id,
        municipalityId: muni.id,
        role: "citizen",
      });
      return {
        user: {
          ...mapUser(row),
          municipalitySlug: muni.slug,
        },
      };
    }

    case "admin": {
      const slug = entry.municipalitySlug!;
      const muni = await getMunicipalityBySlug(slug);
      if (!muni || muni.settings.deputacionPlatform) {
        throw new DemoMunicipalityNotCreatedError(slug);
      }
      const row = await upsertUserRecord({
        preferredId: entry.id,
        municipalityId: muni.id,
        organizationId: null,
        role: "admin",
        displayName: entry.displayName,
        email: entry.email,
        personIdentifier: entry.personIdentifier,
        clubId: null,
      });
      await grantUserRole({
        userId: row.id,
        municipalityId: muni.id,
        role: "admin",
      });
      await markMatchingInvitationsUsed(
        muni.id,
        "admin",
        entry.personIdentifier,
        entry.email,
      );
      return {
        user: {
          ...mapUser(row),
          municipalitySlug: muni.slug,
        },
      };
    }

    case "conserxe": {
      const slug = entry.municipalitySlug!;
      const muni = await getMunicipalityBySlug(slug);
      if (!muni || muni.settings.deputacionPlatform) {
        throw new DemoMunicipalityNotCreatedError(slug);
      }
      const row = await upsertUserRecord({
        preferredId: entry.id,
        municipalityId: muni.id,
        organizationId: null,
        role: "staff",
        displayName: entry.displayName,
        email: entry.email,
        personIdentifier: entry.personIdentifier,
        clubId: null,
      });
      await grantUserRole({
        userId: row.id,
        municipalityId: muni.id,
        role: "staff",
      });
      await markMatchingInvitationsUsed(
        muni.id,
        "staff",
        entry.personIdentifier,
        entry.email,
      );
      return {
        user: {
          ...mapUser(row),
          municipalitySlug: muni.slug,
        },
      };
    }

    case "club": {
      const slug = entry.municipalitySlug!;
      const muni = await getMunicipalityBySlug(slug);
      if (!muni || muni.settings.deputacionPlatform) {
        throw new DemoMunicipalityNotCreatedError(slug);
      }

      const targetClubKey = normalizeClubLookupKey(entry.clubName ?? "");
      const clubs = await listClubs(muni.id);
      const matchedClub = clubs.find(
        (c) =>
          normalizeClubLookupKey(c.name) === targetClubKey ||
          normalizeClubLookupKey(c.shortName) === targetClubKey,
      );

      if (!matchedClub) {
        const row = await upsertUserRecord({
          preferredId: entry.id,
          municipalityId: muni.id,
          organizationId: null,
          role: "citizen",
          displayName: entry.displayName,
          email: entry.email,
          personIdentifier: entry.personIdentifier,
          clubId: null,
        });
        await grantUserRole({
          userId: row.id,
          municipalityId: muni.id,
          role: "citizen",
        });
        return {
          user: {
            ...mapUser(row),
            role: "citizen",
            clubId: undefined,
            municipalitySlug: muni.slug,
          },
          warning: "club_non_creado",
        };
      }

      const row = await upsertUserRecord({
        preferredId: entry.id,
        municipalityId: muni.id,
        organizationId: null,
        role: "club_manager",
        displayName: entry.displayName,
        email: entry.email,
        personIdentifier: entry.personIdentifier,
        clubId: matchedClub.id,
      });

      const existingMembership = await getDb()
        .select({ id: t.clubMembers.id })
        .from(t.clubMembers)
        .where(
          and(
            eq(t.clubMembers.clubId, matchedClub.id),
            eq(t.clubMembers.userId, row.id),
            eq(t.clubMembers.municipalityId, muni.id),
          ),
        )
        .limit(1);

      if (!existingMembership[0]) {
        await addClubResponsable({
          municipalityId: muni.id,
          clubId: matchedClub.id,
          userId: row.id,
          email: entry.email,
          displayName: entry.displayName,
          nif: entry.nif,
          role: "manager",
          actor: "system:demo-users-file",
        });
      } else {
        await grantUserRole({
          userId: row.id,
          municipalityId: muni.id,
          role: "club_manager",
          clubId: matchedClub.id,
        });
      }

      return {
        user: {
          ...mapUser(row),
          role: "club_manager",
          clubId: matchedClub.id,
          municipalitySlug: muni.slug,
        },
        activateClubId: matchedClub.id,
      };
    }

    default: {
      const _exhaustive: never = entry.role;
      return _exhaustive;
    }
  }
}

export async function seedDemoFileDeputacionUsers(): Promise<boolean> {
  const loaded = getLoadedDemoFileUsers();
  if (!loaded) return false;
  const depEntries = loaded.filter((u) => u.role === "deputacion");
  if (depEntries.length === 0) return false;

  await ensureDemoDeputacionEntity();
  for (const dep of depEntries) {
    await provisionDemoFileUserOnLogin(dep);
  }
  return true;
}
