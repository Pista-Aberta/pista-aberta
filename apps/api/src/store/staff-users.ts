/**
 * Xestión de persoal (conserxe/staff) polo admin do concello.
 * REVISION-50 S1: se a conta xa existe, convite con token (non ligar soa).
 */
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AuthUser, Role } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapUser } from "../db/mappers.js";
import { toPersonIdentifier } from "../lib/nif.js";
import { grantUserRole, listStaffUserIds } from "./user-roles.js";
import { createInvitation } from "./invitations.js";

const STAFF_ROLES: Role[] = ["staff", "monitor"];

export async function listStaffUsers(
  municipalityId: string,
): Promise<AuthUser[]> {
  const rows = await listStaffRows(municipalityId);
  return rows.map(({ active: _a, linkedExistingCitizen: _l, ...u }) => u);
}

export type StaffRow = AuthUser & {
  active: boolean;
  /** REVISION-28 X3 — xa tiña conta veciña; vinculouse o rol. */
  linkedExistingCitizen?: boolean;
  /** REVISION-50 S1 — enviouse convite en vez de ligar automaticamente. */
  invitePending?: boolean;
  inviteToken?: string;
  inviteUrl?: string;
};

export async function listStaffRows(
  municipalityId: string,
): Promise<StaffRow[]> {
  const db = getDb();
  const ids = await listStaffUserIds(municipalityId);
  if (!ids.length) return [];
  const userIds = ids.map((i) => i.userId);
  const rows = await db
    .select()
    .from(t.users)
    .where(inArray(t.users.id, userIds));
  const meta = new Map(ids.map((i) => [i.userId, i]));
  return rows.map((r) => {
    const m = meta.get(r.id);
    return {
      ...mapUser(r),
      active: m?.active ?? r.active,
      role: (m?.role ?? r.role) as Role,
    };
  });
}

async function inviteExistingAccount(input: {
  municipalityId: string;
  displayName: string;
  email: string;
  role: "staff" | "monitor";
  nif?: string;
  invitedBy?: string;
  existing: typeof t.users.$inferSelect;
}): Promise<StaffRow> {
  if (input.existing.municipalityId !== input.municipalityId) {
    throw new Error("email_other_muni");
  }
  const inv = await createInvitation({
    municipalityId: input.municipalityId,
    role: input.role,
    email: input.email,
    nif: input.nif,
    displayName: input.displayName.trim(),
    createdBy: input.invitedBy?.trim() || "admin",
  });
  return {
    ...mapUser(input.existing),
    active: input.existing.active,
    invitePending: true,
    inviteToken: inv.token,
    inviteUrl: inv.url,
  };
}

export async function inviteStaffUser(input: {
  municipalityId: string;
  displayName: string;
  email: string;
  role?: "staff" | "monitor";
  nif?: string;
  /** Quen deu o acceso (para o correo). */
  invitedBy?: string;
}): Promise<StaffRow> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("email_invalid");
  const staffRole = input.role ?? "staff";
  let personIdentifier: string | null = null;
  if (input.nif?.trim()) {
    try {
      personIdentifier = toPersonIdentifier(input.nif);
    } catch {
      throw new Error("nif_invalid");
    }
  }
  const db = getDb();

  if (personIdentifier) {
    const byNif = await db
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, personIdentifier))
      .limit(1);
    if (byNif[0]) {
      /* REVISION-50 S1: conta existente → convite, non ligar soa. */
      return inviteExistingAccount({
        municipalityId: input.municipalityId,
        displayName: input.displayName,
        email,
        role: staffRole,
        nif: input.nif,
        invitedBy: input.invitedBy,
        existing: byNif[0],
      });
    }
  }

  const existing = await db
    .select()
    .from(t.users)
    .where(eq(t.users.email, email))
    .limit(1);
  if (existing[0]) {
    const ex = existing[0];
    if (ex.municipalityId !== input.municipalityId) {
      throw new Error("email_other_muni");
    }
    if (ex.role === "citizen" || STAFF_ROLES.includes(ex.role as Role)) {
      /* REVISION-50 S1: non ligar automaticamente. */
      return inviteExistingAccount({
        municipalityId: input.municipalityId,
        displayName: input.displayName,
        email,
        role: staffRole,
        nif: input.nif,
        invitedBy: input.invitedBy,
        existing: ex,
      });
    }
    throw new Error("email_not_staffable");
  }
  const id = `staff-${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(t.users)
    .values({
      id,
      municipalityId: input.municipalityId,
      role: staffRole,
      displayName: input.displayName.trim(),
      email,
      personIdentifier,
      locale: "gl",
      active: true,
    })
    .returning();
  await grantUserRole({
    userId: id,
    municipalityId: input.municipalityId,
    role: staffRole,
  });
  /* REVISION-35 G4: persoa nova — correo «Tes acceso…» coa ligazón de acceso. */
  try {
    const { getMunicipalityById } = await import("./db.js");
    const muni = await getMunicipalityById(input.municipalityId);
    if (muni) {
      const { sendRenderedMail } = await import("../notify/send-notice.js");
      const roleLabels: Record<string, string> = {
        staff: "conserxaría",
        monitor: "monitoraxe",
      };
      await sendRenderedMail({
        to: email,
        muni,
        locale: "gl",
        kind: "invite_staff",
        data: {
          inviterName: input.invitedBy?.trim() || muni.name,
          roleLabel: roleLabels[staffRole] ?? staffRole,
          acceptUrl: `/c/${muni.slug}/acceso`,
          inviteeName: input.displayName.trim(),
          nif: input.nif,
          accessGranted: true,
        },
      });
    }
  } catch (err) {
    console.warn(`[mail] dar acceso: ${(err as Error).message}`);
  }
  return { ...mapUser(row!), active: true };
}

export async function revokeStaffUser(
  municipalityId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(t.users)
    .where(
      and(eq(t.users.id, userId), eq(t.users.municipalityId, municipalityId)),
    )
    .limit(1);
  if (!row) throw new Error("staff_not_found");
  const staffMeta = await listStaffUserIds(municipalityId);
  if (!staffMeta.some((s) => s.userId === userId)) {
    throw new Error("not_staff");
  }
  await db
    .update(t.userRoles)
    .set({ active: false })
    .where(
      and(
        eq(t.userRoles.userId, userId),
        eq(t.userRoles.municipalityId, municipalityId),
        inArray(t.userRoles.role, STAFF_ROLES),
      ),
    );
  if (row.role === "citizen") {
    /* Só revoga o rol de persoal; a veciña segue activa. */
    return;
  }
  await db
    .update(t.users)
    .set({ active: false })
    .where(eq(t.users.id, userId));
  await db.delete(t.sessions).where(eq(t.sessions.userId, userId));
}

export async function reactivateStaffUser(
  municipalityId: string,
  userId: string,
): Promise<StaffRow> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(t.users)
    .where(
      and(eq(t.users.id, userId), eq(t.users.municipalityId, municipalityId)),
    )
    .limit(1);
  if (!row) throw new Error("staff_not_found");
  const staffMeta = await listStaffUserIds(municipalityId);
  if (!staffMeta.some((s) => s.userId === userId)) {
    throw new Error("not_staff");
  }
  await db
    .update(t.userRoles)
    .set({ active: true })
    .where(
      and(
        eq(t.userRoles.userId, userId),
        eq(t.userRoles.municipalityId, municipalityId),
        inArray(t.userRoles.role, STAFF_ROLES),
      ),
    );
  if (row.role === "citizen") {
    return { ...mapUser(row), active: true };
  }
  const [updated] = await db
    .update(t.users)
    .set({ active: true, role: row.role })
    .where(eq(t.users.id, userId))
    .returning();
  return { ...mapUser(updated!), active: true };
}
