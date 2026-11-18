/**
 * REVISION-29 Y13 — entidade Deputación, convites de xestores, ancla platform.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AuthUser } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapUser } from "../db/mappers.js";
import { createInvitation } from "./invitations.js";

export const DEPUTACION_PLATFORM_MUNI_ID = "muni-deputacion-platform";
export const DEPUTACION_PLATFORM_SLUG = "_deputacion";
export const DEPUTACION_DEMO_ORG_ID = "org-deputacion-demo";

export type DeputacionOrg = {
  id: string;
  name: string;
  dir3: string | null;
  logoDataUrl: string | null;
  /** REVISION-38 K5 */
  email: string | null;
};

export type DeputacionManagerRow = {
  id: string;
  displayName: string;
  email: string | null;
  personIdentifier: string | null;
  active: boolean;
};

export async function ensureDeputacionPlatformMunicipality(): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(t.municipalities)
    .where(eq(t.municipalities.id, DEPUTACION_PLATFORM_MUNI_ID))
    .limit(1);
  if (existing[0]) return;
  await db.insert(t.municipalities).values({
    id: DEPUTACION_PLATFORM_MUNI_ID,
    slug: DEPUTACION_PLATFORM_SLUG,
    name: "Deputación (plataforma)",
    accentColor: "#002B4A",
    locales: ["gl", "es"],
    settings: {
      maxHoursPerWeek: 0,
      bookingAntelationDays: 0,
      portalPublished: false,
      deputacionPlatform: true,
    },
  });
}

export async function getDeputacionOrganization(): Promise<DeputacionOrg | null> {
  const rows = await getDb().select().from(t.organizations).limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    dir3: r.dir3 ?? null,
    logoDataUrl: r.logoDataUrl ?? null,
    email: r.email ?? null,
  };
}

export async function createDeputacionOrganization(input: {
  name: string;
  dir3?: string;
  /** REVISION-39 L6 — correo de contacto (privacidade / RGPD). */
  email?: string;
}): Promise<DeputacionOrg> {
  await ensureDeputacionPlatformMunicipality();
  const existing = await getDeputacionOrganization();
  const email = input.email?.trim().toLowerCase() || null;
  if (existing) {
    if (email && !existing.email) {
      await getDb()
        .update(t.organizations)
        .set({ email })
        .where(eq(t.organizations.id, existing.id));
      return { ...existing, email };
    }
    return existing;
  }
  const id = `org-${randomUUID().slice(0, 10)}`;
  await getDb().insert(t.organizations).values({
    id,
    name: input.name.trim(),
    dir3: input.dir3?.trim().slice(0, 32) || null,
    email,
  });
  return (await getDeputacionOrganization())!;
}

/** REVISION-39 L6 — actualizar correo de contacto da Deputación. */
export async function updateDeputacionOrganization(input: {
  email?: string;
  name?: string;
}): Promise<DeputacionOrg> {
  const org = await getDeputacionOrganization();
  if (!org) throw new Error("no_deputacion_org");
  const set: { email?: string | null; name?: string } = {};
  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (email && !email.includes("@")) throw new Error("email_invalid");
    set.email = email || null;
  }
  if (input.name?.trim()) set.name = input.name.trim();
  if (Object.keys(set).length) {
    await getDb()
      .update(t.organizations)
      .set(set)
      .where(eq(t.organizations.id, org.id));
  }
  return (await getDeputacionOrganization())!;
}

export async function inviteDeputacionManager(input: {
  email: string;
  nif?: string;
  name?: string;
  createdBy: string;
}): Promise<{ token: string; url: string; expiresAt: Date }> {
  const org = await getDeputacionOrganization();
  if (!org) throw new Error("no_deputacion_org");
  /* REVISION-34 F2: NIF obrigatorio para xestora. */
  const nif = input.nif?.trim();
  if (!nif) throw new Error("nif_invalid");
  await ensureDeputacionPlatformMunicipality();
  return createInvitation({
    municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
    organizationId: org.id,
    role: "superadmin",
    email: input.email,
    nif,
    displayName: input.name,
    createdBy: input.createdBy,
  });
}

export async function listDeputacionManagers(): Promise<DeputacionManagerRow[]> {
  const org = await getDeputacionOrganization();
  if (!org) return [];
  const rows = await getDb()
    .select()
    .from(t.users)
    .where(
      and(
        eq(t.users.organizationId, org.id),
        eq(t.users.role, "superadmin"),
      ),
    );
  return rows.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    personIdentifier: u.personIdentifier,
    active: u.active,
  }));
}

export async function retirarDeputacionManager(
  userId: string,
  actor: string,
): Promise<void> {
  const org = await getDeputacionOrganization();
  if (!org) throw new Error("no_deputacion_org");
  const db = getDb();
  const rows = await db
    .select()
    .from(t.users)
    .where(and(eq(t.users.id, userId), eq(t.users.organizationId, org.id)))
    .limit(1);
  const u = rows[0];
  if (!u || u.role !== "superadmin") throw new Error("not_found");
  await db
    .update(t.users)
    .set({ active: false, role: "citizen" })
    .where(eq(t.users.id, userId));
  const { audit } = await import("./extra.js");
  await audit(
    DEPUTACION_PLATFORM_MUNI_ID,
    actor,
    "deputacion.manager.revoke",
    `Retirado xestor Deputación: ${u.displayName}`,
  );
}

/** Demo + migración: Deputación de proba ligada á súa entidade. */
export async function ensureDemoDeputacionEntity(): Promise<void> {
  await ensureDeputacionPlatformMunicipality();
  const db = getDb();
  const orgRows = await db
    .select()
    .from(t.organizations)
    .where(eq(t.organizations.id, DEPUTACION_DEMO_ORG_ID))
    .limit(1);
  if (!orgRows[0]) {
    await db.insert(t.organizations).values({
      id: DEPUTACION_DEMO_ORG_ID,
      name: "Deputación de proba",
      dir3: "L01000000",
      email: "contacto@deputacion.demo.pistaaberta.com",
    });
  } else if (!orgRows[0].email) {
    await db
      .update(t.organizations)
      .set({ email: "contacto@deputacion.demo.pistaaberta.com" })
      .where(eq(t.organizations.id, DEPUTACION_DEMO_ORG_ID));
  }

  await db
    .update(t.users)
    .set({
      municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
      organizationId: DEPUTACION_DEMO_ORG_ID,
      role: "superadmin",
      active: true,
    })
    .where(eq(t.users.id, "user-deputacion"));
}

export function isDeputacionPlatformMunicipalityId(id: string): boolean {
  return id === DEPUTACION_PLATFORM_MUNI_ID;
}

export type DeputacionManagerAuth = AuthUser & { organizationId: string };

export async function mapDeputacionUser(
  row: typeof t.users.$inferSelect,
): Promise<AuthUser> {
  const base = mapUser(row);
  return {
    ...base,
    organizationId: row.organizationId ?? null,
  };
}
