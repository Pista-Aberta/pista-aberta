/**
 * REVISION-27 §3.2 — convites dun só uso (admin, persoal, club).
 * REVISION-30 Z1 — aceptar non estraga contas existentes.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthUser, Role } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapUser } from "../db/mappers.js";
import { toPersonIdentifier } from "../lib/nif.js";
import { grantUserRole } from "./user-roles.js";
import { audit } from "./extra.js";

const INVITE_DAYS = 7;

export type InvitationPublic = {
  token: string;
  municipalityId: string;
  municipalityName: string;
  municipalitySlug: string;
  role: Role;
  email?: string | null;
  displayName?: string | null;
  expiresAt: string;
  used: boolean;
  expired: boolean;
  clubId?: string | null;
};

function appBase(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function inviteUrl(token: string): string {
  return `${appBase()}/convite/${token}`;
}

export async function createInvitation(input: {
  municipalityId: string;
  organizationId?: string;
  role: Role;
  email?: string;
  nif?: string;
  displayName?: string;
  clubId?: string;
  createdBy: string;
}): Promise<{ token: string; url: string; expiresAt: Date }> {
  /* REVISION-38 K3: admin / xestora esixen NIF (letra válida). */
  const nifRequired =
    input.role === "admin" || input.role === "superadmin";
  let personIdentifier: string | null = null;
  if (nifRequired && !input.nif?.trim()) {
    throw new Error("nif_required");
  }
  if (input.nif?.trim()) {
    personIdentifier = toPersonIdentifier(input.nif);
  }
  const normalizedEmail = input.email?.trim().toLowerCase() || null;
  if (!personIdentifier && !normalizedEmail) {
    throw new Error("invite_target_required");
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const id = `inv-${randomUUID().slice(0, 10)}`;
  await getDb().insert(t.invitations).values({
    id,
    token,
    municipalityId: input.municipalityId,
    organizationId: input.organizationId ?? null,
    role: input.role,
    email: normalizedEmail,
    displayName: input.displayName?.trim() || null,
    personIdentifier,
    clubId: input.clubId ?? null,
    expiresAt,
    createdBy: input.createdBy,
  });
  await audit(
    input.municipalityId,
    input.createdBy,
    "invite.create",
    `Convite ${input.role}${input.email ? ` <${input.email}>` : ""} · ${inviteUrl(token)}`,
  );
  const url = inviteUrl(token);
  if (input.email?.trim()) {
    try {
      const { getMunicipalityById } = await import("./db.js");
      const muni = (await getMunicipalityById(input.municipalityId)) ?? null;
      const { sendRenderedMail } = await import("../notify/send-notice.js");
      const expiresLabel = expiresAt.toLocaleDateString("gl-ES", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const roleLabels: Record<string, string> = {
        admin: "administración",
        staff: "conserxaría",
        monitor: "monitoraxe",
        club_manager: "xestión do club",
        superadmin: "Deputación",
      };
      const inviteeName = input.displayName?.trim() || undefined;
      if (input.role === "superadmin") {
        const { getDeputacionOrganization } = await import("./deputacion-org.js");
        const org = await getDeputacionOrganization();
        await sendRenderedMail({
          to: input.email.trim().toLowerCase(),
          muni,
          locale: "gl",
          kind: "invite_deputacion",
          data: {
            variant: "deputacion_manager",
            acceptUrl: `/convite/${token}`,
            expiresLabel,
            nif: input.nif,
            concelloName: org?.name ?? "Deputación",
            inviteeName,
          },
        });
      } else if (input.role === "admin") {
        /* REVISION-35 G3/G6: admin de concello → deseño 13 (non «Convite ao persoal»). */
        await sendRenderedMail({
          to: input.email.trim().toLowerCase(),
          muni,
          locale: "gl",
          kind: "invite_deputacion",
          data: {
            variant: "muni_admin",
            acceptUrl: `/convite/${token}`,
            expiresLabel,
            nif: input.nif,
            concelloName: muni?.name,
            inviteeName,
          },
        });
      } else {
        await sendRenderedMail({
          to: input.email.trim().toLowerCase(),
          muni,
          locale: "gl",
          kind: "invite_staff",
          data: {
            inviterName: input.createdBy,
            roleLabel: roleLabels[input.role] ?? input.role,
            acceptUrl: `/convite/${token}`,
            expiresLabel,
            nif: input.nif,
            inviteeName,
          },
        });
      }
    } catch (err) {
      console.warn(`[mail] convite: ${(err as Error).message}`);
    }
  }
  return { token, url, expiresAt };
}

export async function getInvitationByToken(
  token: string,
): Promise<InvitationPublic | null> {
  const rows = await getDb()
    .select({
      inv: t.invitations,
      name: t.municipalities.name,
      slug: t.municipalities.slug,
      orgName: t.organizations.name,
    })
    .from(t.invitations)
    .innerJoin(
      t.municipalities,
      eq(t.municipalities.id, t.invitations.municipalityId),
    )
    .leftJoin(
      t.organizations,
      eq(t.organizations.id, t.invitations.organizationId),
    )
    .where(eq(t.invitations.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const inv = row.inv;
  const now = Date.now();
  const displayName =
    inv.role === "superadmin" && row.orgName
      ? row.orgName
      : row.name;
  return {
    token: inv.token,
    municipalityId: inv.municipalityId,
    municipalityName: displayName,
    municipalitySlug: row.slug,
    role: inv.role as Role,
    email: inv.email,
    displayName: inv.displayName,
    expiresAt: inv.expiresAt.toISOString(),
    used: !!inv.usedAt,
    expired: inv.expiresAt.getTime() < now,
    clubId: inv.clubId,
  };
}

export async function acceptInvitation(input: {
  token: string;
  user: AuthUser;
}): Promise<AuthUser> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.invitations)
    .where(eq(t.invitations.token, input.token))
    .limit(1);
  const inv = rows[0];
  if (!inv) throw new Error("invite_not_found");
  if (inv.usedAt) throw new Error("invite_used");
  if (inv.expiresAt.getTime() < Date.now()) throw new Error("invite_expired");

  const personId = input.user.personIdentifier?.trim();
  if (!personId) throw new Error("nif_required");
  if (inv.personIdentifier && inv.personIdentifier !== personId) {
    throw new Error("invite_wrong_person");
  }

  const role = inv.role as Role;
  let userId = input.user.id;

  const existingByNif = await db
    .select()
    .from(t.users)
    .where(eq(t.users.personIdentifier, personId))
    .limit(1);
  if (existingByNif[0] && existingByNif[0].id !== userId) {
    userId = existingByNif[0].id;
  }

  const existing = (
    await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1)
  )[0];
  if (!existing) throw new Error("user_not_found");

  const inviteEmail = inv.email?.trim().toLowerCase() || null;
  /* REVISION-60 N8: convite sen NIF só pode aceptalo a conta co correo convidado. */
  if (!inv.personIdentifier) {
    const acceptingEmail =
      (existing.email ?? input.user.email ?? "").trim().toLowerCase();
    if (!inviteEmail || !acceptingEmail || acceptingEmail !== inviteEmail) {
      throw new Error("invite_wrong_person");
    }
  }
  if (inviteEmail) {
    const byEmail = await db
      .select()
      .from(t.users)
      .where(eq(t.users.email, inviteEmail))
      .limit(1);
    if (byEmail[0] && byEmail[0].id !== userId) {
      throw new Error("email_clash");
    }
  }

  /* REVISION-30 Z1: conta existente noutro concello — só grantUserRole.
   * Conta nova (citizen no mesmo concello do convite): promove o rol global. */
  const patch: {
    personIdentifier?: string;
    email?: string;
    active?: boolean;
    organizationId?: string | null;
    role?: Role;
    municipalityId?: string;
    displayName?: string;
  } = {
    personIdentifier: personId,
    active: true,
  };
  if (!existing.email?.trim() && inviteEmail) {
    patch.email = inviteEmail;
  }
  /* REVISION-37 I3: nome do convite se a persoa é nova ou o actual veu do certificado
   * (toProperName xa quitou as maiúsculas; comparar sen acentos). Non pisar contas establecidas (Z1). */
  const inviteName = inv.displayName?.trim();
  if (inviteName) {
    const cur = (existing.displayName ?? "").trim();
    const fold = (s: string) =>
      s
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase();
    const fromCertOrEmpty =
      !cur ||
      cur === existing.email ||
      cur === (existing.email?.split("@")[0] ?? "") ||
      fold(cur) === fold(inviteName);
    if (fromCertOrEmpty) patch.displayName = inviteName;
  }
  const isFreshCitizenHome =
    existing.role === "citizen" &&
    existing.municipalityId === inv.municipalityId &&
    (role === "admin" || role === "staff" || role === "monitor");
  if (isFreshCitizenHome) {
    patch.role = role;
  }
  /* Superadmin precisa organizationId na fila users para o panel Deputación. */
  if (role === "superadmin" && inv.organizationId) {
    patch.organizationId = inv.organizationId;
    patch.role = "superadmin";
    patch.municipalityId = inv.municipalityId;
  }
  await db.update(t.users).set(patch).where(eq(t.users.id, userId));

  if (role !== "superadmin") {
    await grantUserRole({
      userId,
      municipalityId: inv.municipalityId,
      role,
      clubId: inv.clubId,
    });
  } else {
    await grantUserRole({
      userId,
      municipalityId: inv.municipalityId,
      role: "superadmin",
    });
  }

  if (role === "club_manager" && inv.clubId) {
    const { addClubResponsable } = await import("./club-members.js");
    const users = await db
      .select()
      .from(t.users)
      .where(eq(t.users.id, userId))
      .limit(1);
    const u = users[0];
    await addClubResponsable({
      municipalityId: inv.municipalityId,
      clubId: inv.clubId,
      userId,
      email: u?.email ?? inviteEmail ?? undefined,
      displayName: u?.displayName,
      actor: inv.createdBy,
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      if (msg !== "already_member") throw e;
    });
  }

  await db
    .update(t.invitations)
    .set({ usedAt: new Date() })
    .where(and(eq(t.invitations.id, inv.id), isNull(t.invitations.usedAt)));

  await audit(
    inv.municipalityId,
    input.user.displayName,
    "invite.accept",
    `Aceptou convite ${role} (${inv.token.slice(0, 8)}…)`,
  );

  const users = await db
    .select()
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  if (!users[0]) throw new Error("user_not_found");
  return mapUser(users[0]);
}

/** REVISION-29 Y2 — só PA_DEMO explícito: identidade de proba co NIF do convite. */
export async function demoAcceptInvitation(token: string): Promise<AuthUser> {
  const paDemo =
    process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true";
  if (!paDemo) throw new Error("demo_only");

  const db = getDb();
  const rows = await db
    .select({
      inv: t.invitations,
      slug: t.municipalities.slug,
    })
    .from(t.invitations)
    .innerJoin(
      t.municipalities,
      eq(t.municipalities.id, t.invitations.municipalityId),
    )
    .where(eq(t.invitations.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("invite_not_found");
  const inv = row.inv;
  if (inv.usedAt) throw new Error("invite_used");
  if (inv.expiresAt.getTime() < Date.now()) throw new Error("invite_expired");

  let personIdentifier = inv.personIdentifier?.trim() ?? null;
  if (!personIdentifier) {
    /* Convites sen NIF (asistente só con correo): NIF de proba estable polo token. */
    const digits = Array.from(token)
      .map((ch) => ch.charCodeAt(0))
      .reduce((a, b) => (a * 31 + b) % 100_000_000, 7)
      .toString()
      .padStart(8, "0");
    const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
    const letter = letters[Number(digits) % 23]!;
    personIdentifier = `ES/ES/${digits}${letter}`;
  }

  const email = inv.email?.trim().toLowerCase() || null;
  const inviteName =
    inv.displayName?.trim() ||
    email?.split("@")[0]?.replace(/\./g, " ") ||
    `Admin ${row.slug}`;

  let existing = (
    await db
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, personIdentifier))
      .limit(1)
  )[0];
  /* Reconvite co mesmo correo pero outro NIF (sintético vs explícito): reutilizar conta. */
  if (!existing && email) {
    existing = (
      await db
        .select()
        .from(t.users)
        .where(eq(t.users.email, email))
        .limit(1)
    )[0];
  }

  let userId: string;
  if (existing) {
    userId = existing.id;
    /* Conta existente: só asegurar NIF e active; non mover concello nin rol. */
    await db
      .update(t.users)
      .set({
        active: true,
        personIdentifier,
        ...(email && !existing.email ? { email } : {}),
      })
      .where(eq(t.users.id, userId));
  } else {
    userId = `user-inv-${randomUUID().slice(0, 10)}`;
    await db.insert(t.users).values({
      id: userId,
      municipalityId: inv.municipalityId,
      role: "citizen",
      displayName: inviteName,
      email,
      personIdentifier,
      locale: "gl",
      active: true,
    });
  }

  const authUser: AuthUser = {
    id: userId,
    municipalityId: existing?.municipalityId ?? inv.municipalityId,
    role: (existing?.role as Role) ?? "citizen",
    displayName: existing?.displayName ?? inviteName,
    email: existing?.email ?? email ?? undefined,
    personIdentifier,
    locale: "gl",
    municipalitySlug: row.slug,
  };

  return acceptInvitation({ token, user: authUser });
}
