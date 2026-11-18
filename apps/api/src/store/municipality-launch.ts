/**
 * REVISION-27 §3.1–3.4 — alta completa, checklist, publicar portal, vista Deputación.
 * REVISION-30 Z1/Z2/Z4 — contas, publicar, instalacións reais no asistente.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FacilityType, Municipality, Role } from "@pista-aberta/shared";
import { resolveTheme } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapMunicipality, mapUser } from "../db/mappers.js";
import { clearSessionsActiveMuniRole } from "../identity/sessions.js";
import { detectShieldBrandColor } from "../lib/shield-color.js";
import { newId } from "../lib/ids.js";
import { toPersonIdentifier } from "../lib/nif.js";
import { isDemoEmptyMode, isDemoMode } from "../env.js";
import { createMunicipality, getMunicipalityById, getMunicipalityBySlug, listFacilities } from "./db.js";
import { createInvitation, inviteUrl } from "./invitations.js";
import {
  defaultRulesTextForType,
  defaultSlotMinutesForType,
  FACILITY_DRAFT_RULES,
  unitTemplatesForFacility,
} from "./facility-admin-templates.js";
import { ensureSlotsAhead } from "./slots-ahead.js";
import { audit } from "./extra.js";
import { grantUserRole, revokeUserRole } from "./user-roles.js";
import {
  DEFAULT_ANONYMIZE_AFTER_DAYS,
  DEFAULT_MAX_ACTIVE_BOOKINGS,
  DEFAULT_TIMEZONE,
  QR_CHECKIN_MARGIN_MINUTES,
} from "./business-rules.js";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Monorepo root (apps/api/src/store → ../../../..). */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export function isPortalPublished(m: Municipality): boolean {
  if (m.settings.sandbox) return true;
  return m.settings.portalPublished !== false;
}

export type WizardFacilityInput = { name: string; type: string };

export type WizardScheduleRow = { open: string; close: string };

export type CreateFromWizardInput = {
  name: string;
  slug: string;
  ine: string;
  accentColor?: string;
  dir3?: string;
  markedFacilities: string[];
  /** REVISION-30 Z4 — nomes editados (clave = nome do censo). */
  facilityNames?: Record<string, string>;
  schedule: Record<string, WizardScheduleRow>;
  norms: { rule1?: boolean; rule2?: boolean; rule3?: boolean };
  adminEmail?: string;
  adminDisplayName?: string;
  adminNif?: string;
  /**
   * REVISION-63 F3 — permite crear o concello sen convite admin
   * (p.ex. DEMO_SETUP_FILE cando non hai admin en DEMO_USERS_FILE).
   */
  allowWithoutAdminInvite?: boolean;
  /** REVISION-32 C2 — correo xeral do concello (datos legais). */
  legalEmail?: string;
  sandbox: boolean;
  createdBy: string;
};

export type WizardResult = Municipality & {
  invite?: { token: string; url: string; expiresAt: string };
  facilitiesCreated: number;
  brandColor: string;
};

function mapOsmType(raw: string): string {
  const k = raw.toLowerCase();
  if (k.includes("pavill") || k.includes("pabell")) return "pavillon";
  if (k.includes("pisc")) return "piscina";
  if (k.includes("futbol") || k.includes("fútbol") || k.includes("campo")) return "campo";
  if (k.includes("sala")) return "sala";
  if (k.includes("atlet")) return "atletismo";
  return "pista";
}

type ListaFac = { name: string; type: string; courts?: number };
type ListaRow = {
  ine: string;
  name: string;
  slug: string;
  facilities?: ListaFac[];
  proposedAddress?: string;
};

type Point = [number, number, string];

function loadCensus(ine: string, slug: string): {
  row: ListaRow | null;
  points: Point[];
} {
  let row: ListaRow | null = null;
  const listaPath = path.join(REPO_ROOT, "data/concellos-lista.json");
  if (fs.existsSync(listaPath)) {
    const lista = JSON.parse(fs.readFileSync(listaPath, "utf8")) as ListaRow[];
    row = lista.find((c) => c.ine === ine || c.slug === slug) ?? null;
  }
  let points: Point[] = [];
  const puntosPath = path.join(REPO_ROOT, "data/instalacions-puntos.json");
  if (fs.existsSync(puntosPath)) {
    const all = JSON.parse(fs.readFileSync(puntosPath, "utf8")) as Record<string, Point[]>;
    points = all[ine] ?? [];
  }
  return { row, points };
}

/** Nomes de instalacións do censo para o asistente / DEMO_SETUP_FILE (sen piscinas). */
export function censusFacilityNamesForIne(ine: string, slug: string): string[] {
  const { row } = loadCensus(ine, slug);
  const names = (row?.facilities ?? [])
    .filter((f) => f.type !== "piscina" && !/piscina/i.test(f.name))
    .map((f) => f.name);
  return names.length > 0 ? names : ["Pista municipal"];
}

function osmTypeMatchesPoint(facType: string, osmType: string): boolean {
  const mapped = mapOsmType(facType);
  const p = mapOsmType(String(osmType));
  if (mapped === p) return true;
  if (mapped === "pista" && ["padel", "tenis", "baloncesto", "multi", "pista"].includes(p)) {
    return true;
  }
  return false;
}

function madridDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Nome curto do concello (sen «Concello de»). */
export function shortMunicipalityName(name: string): string {
  return name.replace(/^Concello de\s+/i, "").trim() || name;
}

/** REVISION-30 Z4 / REVISION-31 B3 — nome limpo sen «(6)» e co nome curto. */
export function friendlyFacilityName(
  rawName: string,
  type: FacilityType,
  muniName: string,
): string {
  const short = shortMunicipalityName(muniName);
  const base = rawName.replace(/\s*\(\d+\)\s*$/, "").trim();
  if (/pavill/i.test(base) || type === "pavillon") {
    return `Pavillón municipal de ${short}`;
  }
  if (/campo|fútbol|futbol/i.test(base) || type === "campo") {
    return `Campos municipais de ${short}`;
  }
  if (/sala/i.test(base) || type === "sala") {
    return `Salas municipais de ${short}`;
  }
  if (base && !/^\d+$/.test(base)) {
    return `${base} municipais de ${short}`.replace(/\s+/g, " ");
  }
  return `Pistas municipais de ${short}`;
}

function censusUnitWord(type: FacilityType, n: number): string {
  if (type === "campo") return n === 1 ? "campo" : "campos";
  if (type === "pavillon") return n === 1 ? "pista" : "pistas";
  if (type === "sala") return n === 1 ? "sala" : "salas";
  return n === 1 ? "pista" : "pistas";
}

function capacityForType(type: FacilityType): number {
  if (type === "campo") return 22;
  if (type === "pavillon") return 20;
  if (type === "sala") return 15;
  return 4;
}

export async function createMunicipalityFromWizard(
  input: CreateFromWizardInput,
): Promise<WizardResult> {
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const brand = input.accentColor?.trim() || detectShieldBrandColor(slug);
  const { row, points } = loadCensus(input.ine, slug);
  const address = row?.proposedAddress ?? "Casa do Concello";
  const marked = new Set(input.markedFacilities);
  const selectedFacilities =
    row?.facilities?.filter((f) => marked.has(f.name)) ??
    input.markedFacilities.map((name) => ({ name, type: "pista" }));

  const bookingAntelationDays = input.norms.rule2 !== false ? 7 : 14;
  const cancelMinHours = input.norms.rule3 !== false ? 2 : 4;
  const adminEmail = input.adminEmail?.trim().toLowerCase() || undefined;
  const legalEmail = input.legalEmail?.trim().toLowerCase() || "";
  const muniName = input.name.trim();
  const shortName = shortMunicipalityName(muniName);
  const sandbox = input.sandbox === true;

  const existing = await getMunicipalityBySlug(slug);
  if (existing) throw new Error("slug_exists");

  const theme = resolveTheme({
    accentColor: brand,
    theme: { brand, accent: brand },
  });
  const ineCode = String(input.ine ?? "").replace(/\D/g, "").slice(0, 5);
  const settings: Municipality["settings"] = {
    maxHoursPerWeek: 4,
    bookingAntelationDays,
    maxActiveBookings: DEFAULT_MAX_ACTIVE_BOOKINGS,
    anonymizeAfterDays: DEFAULT_ANONYMIZE_AFTER_DAYS,
    cancelMinHours,
    checkInMarginMinutes: QR_CHECKIN_MARGIN_MINUTES,
    noShowReleaseMinutes: 30,
    timezone: DEFAULT_TIMEZONE,
    theme,
    /* REVISION-32 C2: correo xeral no paso 4; titular + enderezo Casa do Concello. */
    legal: {
      titular: muniName,
      email: legalEmail,
      address,
    },
    /* REVISION-40 N2: INE para MeteoGalicia. */
    ...(/^\d{5}$/.test(ineCode) ? { ineCode } : {}),
    ...(sandbox
      ? {
          sandbox: true,
          sandboxExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          portalPublished: true,
        }
      : { portalPublished: false }),
    ...(isDemoMode() && !isDemoEmptyMode() ? { demoCreatedDay: madridDayKey() } : {}),
    ...(input.dir3?.trim()
      ? { openData: { dir3: input.dir3.trim().slice(0, 32) } }
      : {}),
  };

  const mid = `muni-${slug}`;
  const pointsByType = new Map<string, Point[]>();
  for (const pt of points) {
    const ty = mapOsmType(String(pt[2]));
    const list = pointsByType.get(ty) ?? [];
    list.push(pt);
    pointsByType.set(ty, list);
  }
  const usedPointIdx = new Map<string, number>();

  const inviteToken = randomBytes(24).toString("base64url");
  const inviteExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const inviteId = newId("inv");
  /* REVISION-38 K3: NIF da admin obrigatorio + letra válida (agás omitir convite). */
  const adminNifRaw = input.adminNif?.trim() ?? "";
  if (!adminNifRaw && !input.allowWithoutAdminInvite) {
    throw new Error("nif_required");
  }
  const personIdentifier = adminNifRaw
    ? toPersonIdentifier(adminNifRaw)
    : null;

  const db = getDb();
  const { created, unitIds } = await db.transaction(async (tx) => {
    await tx.insert(t.municipalities).values({
      id: mid,
      slug,
      name: muniName,
      accentColor: theme.brand,
      locales: ["gl", "es"],
      settings,
    });

    let createdCount = 0;
    const allUnitIds: string[] = [];
    const unitIdsByType = new Map<string, string[]>();

    for (const f of selectedFacilities) {
      if (f.type === "piscina" || /piscina/i.test(f.name)) continue;
      const type = mapOsmType(f.type) as FacilityType;
      const pool =
        pointsByType.get(type) ??
        points.filter((p) => osmTypeMatchesPoint(f.type, String(p[2])));
      let lat = "42.861";
      let lng = "-8.902";
      const idx = usedPointIdx.get(type) ?? 0;
      if (pool[idx]) {
        lng = String(pool[idx]![0]);
        lat = String(pool[idx]![1]);
        usedPointIdx.set(type, idx + 1);
      } else if (pool[0]) {
        lng = String(pool[0]![0]);
        lat = String(pool[0]![1]);
      }

      const countMatch = f.name.match(/\((\d+)\)\s*$/);
      const censusCount = Math.max(
        1,
        Math.min(99, countMatch ? Number(countMatch[1]) : 1),
      );
      const renamed = input.facilityNames?.[f.name]?.trim();
      const displayName =
        renamed || friendlyFacilityName(f.name, type, muniName);
      /* REVISION-31 A4: unha unidade por instalación; censo só no aviso. */
      const censusNote =
        censusCount > 1
          ? `O censo detectou ${censusCount} ${censusUnitWord(type, censusCount)} en ${shortName}: crea unha instalación por recinto.`
          : "Revisa nome, enderezo e mapa antes de publicar.";

      const facId = `fac-${slug}-w-${createdCount + 1}`;
      const templates = unitTemplatesForFacility(type, 1, false);
      const slotMinutes = defaultSlotMinutesForType(type);
      await tx.insert(t.facilities).values({
        id: facId,
        municipalityId: mid,
        name: displayName,
        type,
        address,
        lat,
        lng,
        accessibility: "",
        services: [],
        rules: `${FACILITY_DRAFT_RULES} ${censusNote}`,
        rulesText: defaultRulesTextForType(type, false),
        active: false,
      });
      const list = unitIdsByType.get(type) ?? [];
      for (const tpl of templates) {
        const unitId = `unit-${slug}-w-${createdCount + 1}-1`;
        await tx.insert(t.units).values({
          id: unitId,
          facilityId: facId,
          municipalityId: mid,
          name: tpl.name,
          incompatibleWith: [],
          bookingKind: tpl.bookingKind ?? "ambas",
          capacity: tpl.capacity ?? capacityForType(type),
          active: false,
          slotMinutes: tpl.slotMinutes ?? slotMinutes,
        });
        list.push(unitId);
        allUnitIds.push(unitId);
      }
      unitIdsByType.set(type, list);
      createdCount += 1;
    }

    for (const [type, uids] of unitIdsByType) {
      const rowSched =
        input.schedule[type] ??
        input.schedule.default ??
        input.schedule.pista ??
        { open: "09:00", close: "22:00" };
      for (const unitId of uids) {
        const unitRows = await tx
          .select()
          .from(t.units)
          .where(eq(t.units.id, unitId))
          .limit(1);
        const unit = unitRows[0];
        if (!unit) continue;
        for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
          await tx.insert(t.openingHours).values({
            id: newId("oh"),
            municipalityId: mid,
            facilityId: unit.facilityId,
            unitId,
            weekday,
            open: rowSched.open,
            close: rowSched.close,
            validFrom: null,
            validTo: null,
          });
        }
      }
    }

    if (personIdentifier) {
      await tx.insert(t.invitations).values({
        id: inviteId,
        token: inviteToken,
        municipalityId: mid,
        organizationId: null,
        role: "admin",
        email: adminEmail ?? null,
        displayName: input.adminDisplayName?.trim() || null,
        personIdentifier,
        clubId: null,
        expiresAt: inviteExpiresAt,
        createdBy: input.createdBy,
      });
    }

    await tx.insert(t.auditEvents).values({
      id: newId("au"),
      municipalityId: mid,
      at: new Date(),
      actor: input.createdBy,
      action: "wizard",
      detail: personIdentifier
        ? `Alta ${muniName}; ${createdCount} instalacións borrador; convite admin`
        : `Alta ${muniName}; ${createdCount} instalacións borrador; sen convite admin`,
    });
    if (personIdentifier) {
      await tx.insert(t.auditEvents).values({
        id: newId("au"),
        municipalityId: mid,
        at: new Date(),
        actor: input.createdBy,
        action: "invite.create",
        detail: `Convite admin${adminEmail ? ` <${adminEmail}>` : ""} · ${inviteUrl(inviteToken)}`,
      });
    }

    return { created: createdCount, unitIds: allUnitIds };
  });

  /* Fóra da transacción: xeración de franxas (pode ser longa). */
  void unitIds;
  await ensureSlotsAhead(new Date());

  const updated = (await getMunicipalityById(mid))!;

  /* REVISION-35 G3: convite admin por correo despois da transacción. */
  if (adminEmail && personIdentifier) {
    try {
      const { sendRenderedMail } = await import("../notify/send-notice.js");
      const expiresLabel = inviteExpiresAt.toLocaleDateString("gl-ES", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      await sendRenderedMail({
        to: adminEmail,
        muni: updated,
        locale: "gl",
        kind: "invite_deputacion",
        data: {
          variant: "muni_admin",
          acceptUrl: `/convite/${inviteToken}`,
          expiresLabel,
          nif: adminNifRaw,
          concelloName: updated.name,
          inviteeName: input.adminDisplayName?.trim() || undefined,
        },
      });
    } catch (err) {
      console.warn(`[mail] alta concello convite: ${(err as Error).message}`);
    }
  }

  return {
    ...updated,
    invite: personIdentifier
      ? {
          token: inviteToken,
          url: inviteUrl(inviteToken),
          expiresAt: inviteExpiresAt.toISOString(),
        }
      : undefined,
    facilitiesCreated: created,
    brandColor: brand,
  };
}

export type LaunchChecklistItem = {
  id: string;
  done: boolean;
  href: string;
};

export type LaunchChecklist = {
  done: number;
  total: number;
  published: boolean;
  items: LaunchChecklistItem[];
};

export async function computeLaunchChecklist(
  municipalityId: string,
  slug: string,
): Promise<LaunchChecklist> {
  const muni = await getMunicipalityById(municipalityId);
  const published = muni ? isPortalPublished(muni) : false;
  const db = getDb();

  const allFacilities = await db
    .select()
    .from(t.facilities)
    .where(eq(t.facilities.municipalityId, municipalityId));
  const activeFacilities = allFacilities.filter((f) => f.active);
  const facilitiesReviewed =
    activeFacilities.length > 0 &&
    activeFacilities.every(
      (f) =>
        !!f.imageDataUrl ||
        (f.services?.length ?? 0) > 0 ||
        !/borrador|demo/i.test(f.rules ?? ""),
    );

  const ohRows = await db
    .select({ unitId: t.openingHours.unitId })
    .from(t.openingHours)
    .where(eq(t.openingHours.municipalityId, municipalityId));
  const unitsWithHours = new Set(ohRows.map((r) => r.unitId).filter(Boolean));
  const allUnits = await db
    .select()
    .from(t.units)
    .where(eq(t.units.municipalityId, municipalityId));
  /* REVISION-30 Z2: mesma regra ca publishPortal — só unidades de instalacións activas. */
  const activeFacilityIds = new Set(activeFacilities.map((f) => f.id));
  const schedulesOk = allUnits.some(
    (u) =>
      u.active &&
      activeFacilityIds.has(u.facilityId) &&
      unitsWithHours.has(u.id),
  );

  const settings = muni?.settings;
  const normsOk =
    !!settings?.rulesText?.length ||
    (settings?.cancelMinHours != null && settings?.bookingAntelationDays != null);

  const legal = settings?.legal;
  const brandingOk =
    !!settings?.logoDataUrl &&
    !!legal?.titular?.trim() &&
    !!legal?.email?.trim() &&
    !!legal?.address?.trim();

  const staffRows = await db
    .select()
    .from(t.userRoles)
    .where(
      and(
        eq(t.userRoles.municipalityId, municipalityId),
        eq(t.userRoles.active, true),
      ),
    );
  const staffOk = staffRows.some((r) => r.role === "staff" || r.role === "monitor");

  /* REVISION-46: na demo publicada os carteis QR céntranse como listos. */
  const demoQrReady = slug === "exemplo" || slug === "proba";
  const qrOk = demoQrReady && brandingOk && staffOk;

  const items: LaunchChecklistItem[] = [
    {
      id: "facilities",
      done: facilitiesReviewed,
      href: `/c/${slug}/admin/instalacions`,
    },
    {
      id: "schedules",
      done: schedulesOk,
      href: `/c/${slug}/admin/horarios`,
    },
    {
      id: "norms",
      done: normsOk,
      href: `/c/${slug}/admin/normas`,
    },
    {
      id: "branding",
      done: brandingOk,
      href: `/c/${slug}/admin/personalizacion`,
    },
    {
      id: "staff",
      done: staffOk,
      href: `/c/${slug}/admin/persoal`,
    },
    {
      id: "qr",
      done: qrOk,
      href: `/c/${slug}/cartel-qr`,
    },
    {
      id: "publish",
      done: published,
      href: `/c/${slug}/admin`,
    },
  ];
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, published, items };
}

export async function publishPortal(
  municipalityId: string,
  actor: string,
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) throw new Error("not_found");
  const slug = muni.slug;
  const missing: string[] = [];
  const db = getDb();

  const activeFac = await db
    .select()
    .from(t.facilities)
    .where(and(eq(t.facilities.municipalityId, municipalityId), eq(t.facilities.active, true)));
  if (activeFac.length === 0) missing.push("active_facility");

  const ohRows = await db
    .select({ unitId: t.openingHours.unitId })
    .from(t.openingHours)
    .where(eq(t.openingHours.municipalityId, municipalityId));
  const withHours = new Set(ohRows.map((r) => r.unitId));
  const units = await db
    .select()
    .from(t.units)
    .where(eq(t.units.municipalityId, municipalityId));
  const activeUnitIds = new Set(
    units.filter((u) => activeFac.some((f) => f.id === u.facilityId)).map((u) => u.id),
  );
  const scheduleOk = [...activeUnitIds].some((id) => withHours.has(id));
  if (!scheduleOk) missing.push("schedule");

  const legal = muni.settings.legal;
  if (!legal?.titular?.trim() || !legal?.email?.trim() || !legal?.address?.trim()) {
    missing.push("legal");
  }

  if (missing.length > 0) return { ok: false, missing };

  await db
    .update(t.municipalities)
    .set({
      settings: { ...muni.settings, portalPublished: true },
    })
    .where(eq(t.municipalities.id, municipalityId));

  await ensureSlotsAhead(new Date());
  await audit(municipalityId, actor, "portal.publish", "Portal publicado para a veciñanza");
  void slug;
  return { ok: true };
}

export type DeputacionConcelloRow = {
  id: string;
  slug: string;
  name: string;
  portalPublished: boolean;
  checklistDone: number;
  checklistTotal: number;
  adminLabel: string;
  adminUserId?: string;
  facilitiesActive: number;
  facilitiesDraft: number;
  pendingInvite?: { token: string; url: string; email?: string | null; createdAt: string };
  /** REVISION-40 P1 — contacto do servizo de deportes. */
  contact?: {
    serviceName?: string;
    phone?: string;
    email?: string;
  };
};

export async function listDeputacionConcellos(): Promise<DeputacionConcelloRow[]> {
  const rows = await getDb().select().from(t.municipalities);
  const out: DeputacionConcelloRow[] = [];
  for (const row of rows) {
    const m = mapMunicipality(row);
    if (m.settings.sandbox) continue;
    if (m.settings.deputacionPlatform) continue;
    const checklist = await computeLaunchChecklist(m.id, m.slug);
    const allFacilities = await getDb()
      .select({ active: t.facilities.active })
      .from(t.facilities)
      .where(eq(t.facilities.municipalityId, m.id));
    const facilitiesActive = allFacilities.filter((f) => f.active).length;
    const facilitiesDraft = allFacilities.filter((f) => !f.active).length;
    const admins = await getDb()
      .select()
      .from(t.users)
      .where(and(eq(t.users.municipalityId, m.id), eq(t.users.role, "admin"), eq(t.users.active, true)));
    const adminRole = await getDb()
      .select()
      .from(t.userRoles)
      .where(
        and(
          eq(t.userRoles.municipalityId, m.id),
          eq(t.userRoles.role, "admin"),
          eq(t.userRoles.active, true),
        ),
      );
    const adminIds = new Set([
      ...admins.map((a) => a.id),
      ...adminRole.map((r) => r.userId),
    ]);
    let adminLabel = "⚠ Sen admin";
    let adminUserId: string | undefined;
    if (adminIds.size > 0) {
      const id = [...adminIds][0]!;
      const u = admins.find((a) => a.id === id) ?? (await getDb().select().from(t.users).where(eq(t.users.id, id)).limit(1))[0];
      if (u?.personIdentifier) {
        adminLabel = u.displayName;
        adminUserId = u.id;
      } else {
        adminLabel = `${u?.displayName ?? "Admin"} · convite pendente`;
        adminUserId = u?.id;
      }
    }

    const invites = await getDb()
      .select()
      .from(t.invitations)
      .where(
        and(
          eq(t.invitations.municipalityId, m.id),
          eq(t.invitations.role, "admin"),
          isNull(t.invitations.usedAt),
        ),
      )
      .orderBy(desc(t.invitations.createdAt))
      .limit(1);
    const inv = invites[0];
    const pendingInvite =
      inv && inv.expiresAt.getTime() > Date.now()
        ? {
            token: inv.token,
            url: inviteUrl(inv.token),
            email: inv.email,
            createdAt: inv.createdAt.toISOString(),
          }
        : undefined;
    if (adminLabel.startsWith("⚠") && pendingInvite) {
      adminLabel = `Convite pendente${pendingInvite.email ? ` (${pendingInvite.email})` : ""}`;
    }

    const c = m.settings.contact;
    out.push({
      id: m.id,
      slug: m.slug,
      name: m.name,
      portalPublished: isPortalPublished(m),
      checklistDone: checklist.done,
      checklistTotal: checklist.total,
      adminLabel,
      adminUserId,
      facilitiesActive,
      facilitiesDraft,
      pendingInvite,
      contact:
        c?.phone || c?.email || c?.serviceName
          ? {
              serviceName: c.serviceName?.trim() || undefined,
              phone: c.phone?.trim() || undefined,
              email: c.email?.trim() || m.settings.legal?.email?.trim() || undefined,
            }
          : m.settings.legal?.email
            ? { email: m.settings.legal.email.trim() }
            : undefined,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "gl"));
}

export async function revokeAdminInvite(municipalityId: string, actor: string): Promise<void> {
  await getDb()
    .delete(t.invitations)
    .where(
      and(
        eq(t.invitations.municipalityId, municipalityId),
        eq(t.invitations.role, "admin"),
        isNull(t.invitations.usedAt),
      ),
    );
  await audit(municipalityId, actor, "invite.revoke", "Convite admin revogado");
}

export async function retirarAdminAccess(
  municipalityId: string,
  actor: string,
  reason: string,
): Promise<void> {
  const db = getDb();
  /* REVISION-30 Z1: só desactiva o user_role admin deste concello; a conta sigue viva. */
  const roleRows = await db
    .select({ userId: t.userRoles.userId })
    .from(t.userRoles)
    .where(
      and(
        eq(t.userRoles.municipalityId, municipalityId),
        eq(t.userRoles.role, "admin"),
        eq(t.userRoles.active, true),
      ),
    );
  const legacyAdmins = await db
    .select()
    .from(t.users)
    .where(
      and(eq(t.users.municipalityId, municipalityId), eq(t.users.role, "admin")),
    );
  const userIds = new Set([
    ...roleRows.map((r) => r.userId),
    ...legacyAdmins.map((u) => u.id),
  ]);

  await db
    .update(t.userRoles)
    .set({ active: false })
    .where(
      and(
        eq(t.userRoles.municipalityId, municipalityId),
        eq(t.userRoles.role, "admin"),
      ),
    );

  for (const userId of userIds) {
    await revokeUserRole({
      userId,
      municipalityId,
      role: "admin",
    });
    await clearSessionsActiveMuniRole(userId, "admin");
    const u = (
      await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1)
    )[0];
    if (u && u.municipalityId === municipalityId && u.role === "admin") {
      await db
        .update(t.users)
        .set({ role: "citizen" })
        .where(eq(t.users.id, userId));
      await grantUserRole({
        userId,
        municipalityId,
        role: "citizen",
      });
    }
  }
  await audit(
    municipalityId,
    actor,
    "admin.revoke",
    `Retirado acceso admin: ${reason.slice(0, 200)}`,
  );
}

/** Compat: alta simplificada antiga (tests). */
export async function createMunicipalityFull(input: {
  name: string;
  slug: string;
  accentColor: string;
  accent?: string;
  theme?: { brand?: string; accent?: string };
  facilityName?: string;
  adminEmail?: string;
  adminDisplayName?: string;
  adminNif?: string;
  sandbox?: boolean;
  ine?: string;
  markedFacilities?: string[];
  schedule?: Record<string, WizardScheduleRow>;
}): Promise<
  Municipality & {
    admin?: { id: string; email: string; displayName: string };
    invite?: { token: string; url: string };
  }
> {
  if (input.markedFacilities?.length || input.ine) {
    const r = await createMunicipalityFromWizard({
      name: input.name,
      slug: input.slug,
      ine: input.ine ?? "32078",
      accentColor: input.accentColor,
      markedFacilities: input.markedFacilities ?? [input.facilityName ?? "Pista municipal"],
      schedule: input.schedule ?? { pista: { open: "16:00", close: "22:00" } },
      norms: { rule1: true, rule2: true, rule3: true },
      adminEmail: input.adminEmail,
      adminDisplayName: input.adminDisplayName,
      adminNif: input.adminNif,
      sandbox: input.sandbox !== false,
      createdBy: "wizard",
    });
    return {
      ...r,
      admin: input.adminEmail
        ? {
            id: `pending-${input.slug}`,
            email: input.adminEmail,
            displayName: input.adminDisplayName ?? `Admin ${input.name}`,
          }
        : undefined,
      invite: r.invite ? { token: r.invite.token, url: r.invite.url } : undefined,
    };
  }

  const slug = input.slug;
  const brand = input.accentColor;
  const m = await createMunicipality({
    name: input.name,
    slug,
    accentColor: brand,
    accent: input.accent,
    theme: input.theme,
    sandbox: input.sandbox,
  });
  const facId = `fac-${slug}-1`;
  await getDb().insert(t.facilities).values({
    id: facId,
    municipalityId: m.id,
    name: input.facilityName ?? "Pista municipal",
    type: "pista",
    address: "Enderezo demo",
    lat: "42.8",
    lng: "-8.8",
    accessibility: "",
    services: [],
    rules: "Normas demo",
    active: true,
  });
  await getDb().insert(t.units).values({
    id: `unit-${slug}-1`,
    facilityId: facId,
    municipalityId: m.id,
    name: "Pista 1",
    incompatibleWith: [],
  });
  const adminEmail = (input.adminEmail ?? `admin@${slug}.demo.pistaaberta.com`).trim().toLowerCase();
  const adminDisplayName = input.adminDisplayName?.trim() || `Admin ${input.name}`;
  const adminId = `admin-${slug}`;
  await getDb()
    .insert(t.users)
    .values({
      id: adminId,
      municipalityId: m.id,
      role: "admin",
      displayName: adminDisplayName,
      email: adminEmail,
      locale: "gl",
      active: true,
    })
    .onConflictDoUpdate({
      target: t.users.id,
      set: {
        municipalityId: m.id,
        role: "admin",
        displayName: adminDisplayName,
        email: adminEmail,
        active: true,
      },
    });
  await grantUserRole({ userId: adminId, municipalityId: m.id, role: "admin" });
  return {
    ...m,
    admin: { id: adminId, email: adminEmail, displayName: adminDisplayName },
  };
}

export async function countActiveFacilitiesWithSchedule(
  municipalityId: string,
): Promise<number> {
  const facs = await listFacilities(municipalityId);
  if (facs.length === 0) return 0;
  const db = getDb();
  const oh = await db
    .select({ unitId: t.openingHours.unitId })
    .from(t.openingHours)
    .where(eq(t.openingHours.municipalityId, municipalityId));
  const withHours = new Set(oh.map((r) => r.unitId));
  const units = await db.select().from(t.units).where(eq(t.units.municipalityId, municipalityId));
  return facs.filter((f) =>
    units.some((u) => u.facilityId === f.id && withHours.has(u.id)),
  ).length;
}

export type { Role };
