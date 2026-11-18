/**
 * Operacións de panel P1: instalacións, horarios, peches, normas, solicitudes.
 */
import { newId } from "../lib/ids.js";
import { and, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import type {
  Facility,
  FacilityType,
  Municipality,
  RulesTextItem,
  UsageRules,
} from "@pista-aberta/shared";
import {
  ensureBrandContrast,
  formatDayChip,
  normalizeHex,
  resolveTheme,
} from "@pista-aberta/shared";
import { normalizeLogoPayload } from "./sanitize-svg.js";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapFacility, mapUnit } from "../db/mappers.js";
import {
  addDaysIso,
  isSlotInPast,
  localDateIso,
  localWeekday,
  DEFAULT_TIMEZONE,
  normalizeClosureBound,
  parseLocalDateTime,
  slotOverlapsClosureRange,
} from "./business-rules.js";
import {
  computeRulesVersion,
  mergeNormasIntoSettings,
  resolveFacilityRules,
  resolveRulesText,
  rulesFromSettings,
} from "./rules.js";
import { audit } from "./extra.js";
import {
  getActivity,
  getFacility,
  getMunicipalityById,
  listActivities,
  listSlots,
  listUnits,
  pavilionWeekend,
  runLottery,
} from "./db.js";
import { generateLotterySecret, hashSecret } from "./lottery.js";
import { mapApplication } from "../db/mappers.js";
import { regenerateSlotsForUnitAhead } from "./slots-ahead.js";
import {
  drainNotificationOutboxSafely,
  enqueueUserNotice,
  type NotificationOutboxPayload,
} from "../notify/notification-outbox.js";
import { lockBookingResources } from "./booking-locks.js";

function nid(prefix: string) {
  return newId(prefix);
}

export type ClosureAlternative = {
  label: string;
  sublabel?: string;
  date: string;
  slotId: string;
};

/** Até 3 horas libres próximas (REVISION-34 E3 / 35 G8 / 37 I7). Seguro fóra de TX. */
export async function closureAlternativesForBooking(b: {
  municipalityId: string;
  facilityId: string;
  unitId: string;
  date: string;
  start: string;
  slotId: string;
}): Promise<ClosureAlternative[]> {
  const units = await listUnits(b.facilityId);
  const unitName = (unitId: string) =>
    units.find((u) => u.id === unitId)?.name ?? "";
  type Alt = {
    label: string;
    date: string;
    slotId: string;
    start: string;
    unitId: string;
  };
  const candidates: Alt[] = [];
  const days: string[] = [];
  const base = new Date(`${b.date}T12:00:00`);
  for (let i = 0; i < 8 && days.length < 8; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  const allSlots = await listSlots({
    municipalityId: b.municipalityId,
    facilityId: b.facilityId,
    dateFrom: days[0],
    dateTo: days[days.length - 1],
  });
  const byDay = new Map<string, typeof allSlots>();
  for (const s of allSlots) {
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }
  for (const day of days) {
    const slots = byDay.get(day) ?? [];
    const free = slots
      .filter(
        (s) =>
          !s.occupied &&
          !s.closed &&
          s.id !== b.slotId &&
          (day !== b.date || s.start >= b.start),
      )
      .sort((a, c) => a.start.localeCompare(c.start));
    for (const s of free) {
      candidates.push({
        label: "",
        date: day,
        slotId: s.id,
        start: s.start,
        unitId: s.unitId,
      });
    }
  }
  const groups = new Map<string, Alt[]>();
  for (const c of candidates) {
    const key = `${c.date}|${c.start}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  const out: ClosureAlternative[] = [];
  for (const group of groups.values()) {
    if (out.length >= 3) break;
    const first = group[0]!;
    const chip = formatDayChip(first.date, "gl");
    if (group.length > 1) {
      out.push({
        label: `${chip} · ${first.start}`,
        sublabel: `${group.length} pistas`,
        date: first.date,
        slotId: first.slotId,
      });
    } else {
      const pista = unitName(first.unitId);
      out.push({
        label: pista
          ? `${chip} · ${first.start} · ${pista}`
          : `${chip} · ${first.start}`,
        date: first.date,
        slotId: first.slotId,
      });
    }
  }
  return out;
}

/**
 * Post-commit: enche alternativas nos correos de peche encolados baleiros.
 * Evita deadlock PGlite (listSlots usa getDb) e aínda así o correo leva opções.
 */
export async function enrichClosureOutboxAlternatives(
  operationKey: string,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.notificationOutbox)
    .where(isNull(t.notificationOutbox.processedAt));
  let patched = 0;
  for (const row of rows) {
    const payload = row.payload as NotificationOutboxPayload;
    if (payload.operationKey !== operationKey) continue;
    const email = payload.notice?.email;
    if (!email || email.kind !== "facility_closure") continue;
    const data = email.data as Record<string, unknown>;
    const existing = data.alternatives;
    if (Array.isArray(existing) && existing.length > 0) continue;
    const bookingId = typeof data.bookingId === "string" ? data.bookingId : null;
    const facilityId =
      typeof data.facilityId === "string" ? data.facilityId : null;
    const date = typeof data.date === "string" ? data.date : null;
    const start = typeof data.start === "string" ? data.start : null;
    if (!bookingId || !facilityId || !date || !start) continue;
    const booking = (
      await db
        .select()
        .from(t.bookings)
        .where(eq(t.bookings.id, bookingId))
        .limit(1)
    )[0];
    if (!booking) continue;
    const alts = await closureAlternativesForBooking({
      municipalityId: booking.municipalityId,
      facilityId,
      unitId: booking.unitId,
      date,
      start,
      slotId: booking.slotId,
    });
    data.alternatives = alts;
    await db
      .update(t.notificationOutbox)
      .set({ payload: payload as unknown as Record<string, unknown> })
      .where(eq(t.notificationOutbox.id, row.id));
    patched += 1;
  }
  return patched;
}

/** REVISION-50 S4 — só http(s):// no contacto web. */
export function sanitizeContactWeb(raw: string): string {
  const v = String(raw ?? "").trim().slice(0, 200);
  if (!v) return "";
  try {
    const u = new URL(v.includes("://") ? v : `https://${v}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString().slice(0, 200);
  } catch {
    return "";
  }
}

function muniTz(muni: Municipality) {
  return muni.settings.timezone ?? DEFAULT_TIMEZONE;
}

/* ——— Normas ——— */

export async function getNormas(municipalityId: string, facilityId?: string) {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) throw new Error("not_found");
  const facility = facilityId ? await getFacility(facilityId) : null;
  if (facilityId && (!facility || facility.municipalityId !== municipalityId)) {
    throw new Error("not_found");
  }
  const rulesGeneral = rulesFromSettings(muni.settings);
  const rules = resolveFacilityRules(muni, facility);
  const rulesText = resolveRulesText(muni, facility);
  return {
    rules,
    rulesGeneral,
    rulesText,
    rulesOverride: facility?.rulesOverride ?? null,
    rulesVersion:
      muni.settings.rulesVersion ?? computeRulesVersion(rules, rulesText),
    source: facility?.rulesOverride || facility?.rulesText ? "facility" : "muni",
  };
}

export async function putMunicipalityNormas(
  municipalityId: string,
  actor: string,
  body: { rules?: Partial<UsageRules>; rulesText?: RulesTextItem[] },
) {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) throw new Error("not_found");
  const settings = mergeNormasIntoSettings(muni.settings, body);
  await getDb()
    .update(t.municipalities)
    .set({ settings })
    .where(eq(t.municipalities.id, municipalityId));
  await audit(
    municipalityId,
    actor,
    "admin.normas.update",
    `maxActive=${settings.maxActiveBookings}; checkIn=${settings.checkInMarginMinutes}min`,
  );
  return getNormas(municipalityId);
}

/** Personalización (§10): nome, tema AA, escudo, benvida, datos legais, contacto, datos abertos. */
export async function putMunicipalityBranding(
  municipalityId: string,
  actor: string,
  body: {
    name?: string;
    brand?: string;
    accent?: string;
    welcomeGl?: string;
    welcomeEs?: string;
    logoDataUrl?: string | null;
    legal?: {
      titular?: string;
      nif?: string;
      address?: string;
      email?: string;
      dpd?: string;
      sinatura?: string;
    };
    contact?: {
      serviceName?: string;
      phone?: string;
      email?: string;
      address?: string;
      hours?: string;
      web?: string;
    };
    openData?: {
      license?: string;
      dir3?: string;
      catalogPublisher?: string;
    };
    deputacionCanViewPersonalData?: boolean;
  },
) {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) throw new Error("not_found");

  const name = body.name?.trim() || muni.name;
  if (name.length < 2 || name.length > 120) throw new Error("invalid_name");

  const current = resolveTheme({
    accentColor: muni.accentColor,
    theme: muni.settings.theme,
  });
  const rawBrand = body.brand ?? current.brand;
  const checked = ensureBrandContrast(rawBrand);
  const brand = checked.brand;
  const accent = normalizeHex(body.accent ?? current.accent, brand);

  let logoDataUrl = muni.settings.logoDataUrl;
  if (body.logoDataUrl === null) {
    logoDataUrl = undefined;
  } else if (typeof body.logoDataUrl === "string" && body.logoDataUrl.trim()) {
    logoDataUrl = normalizeLogoPayload(body.logoDataUrl);
  }

  const prevLegal = muni.settings.legal ?? {};
  const legal = body.legal
    ? {
        titular: (body.legal.titular ?? prevLegal.titular ?? "").slice(0, 200),
        nif: (body.legal.nif ?? prevLegal.nif ?? "").slice(0, 32),
        address: (body.legal.address ?? prevLegal.address ?? "").slice(0, 300),
        email: (body.legal.email ?? prevLegal.email ?? "").slice(0, 120),
        dpd: (body.legal.dpd ?? prevLegal.dpd ?? "").slice(0, 200),
        sinatura: (body.legal.sinatura ?? prevLegal.sinatura ?? "").slice(0, 120),
      }
    : prevLegal;

  const prevOpen = muni.settings.openData ?? {};
  const openData = body.openData
    ? {
        license: (body.openData.license ?? prevOpen.license ?? "CC BY 4.0").slice(
          0,
          120,
        ),
        dir3: (body.openData.dir3 ?? prevOpen.dir3 ?? "").slice(0, 32),
        catalogPublisher: (
          body.openData.catalogPublisher ??
          prevOpen.catalogPublisher ??
          ""
        ).slice(0, 200),
      }
    : prevOpen;

  const prevContact = muni.settings.contact ?? {};
  const contact = body.contact
    ? {
        serviceName: (body.contact.serviceName ?? prevContact.serviceName ?? "").slice(
          0,
          120,
        ),
        phone: (body.contact.phone ?? prevContact.phone ?? "").slice(0, 40),
        email: (body.contact.email ?? prevContact.email ?? "").slice(0, 120),
        address: (body.contact.address ?? prevContact.address ?? "").slice(0, 300),
        hours: (body.contact.hours ?? prevContact.hours ?? "").slice(0, 300),
        web: sanitizeContactWeb(body.contact.web ?? prevContact.web ?? ""),
      }
    : prevContact;

  const prevDeputacionPii = muni.settings.deputacionCanViewPersonalData === true;
  const deputacionCanViewPersonalData =
    body.deputacionCanViewPersonalData !== undefined
      ? body.deputacionCanViewPersonalData === true
      : prevDeputacionPii;

  const settings = {
    ...muni.settings,
    theme: { brand, accent },
    welcomeGl:
      body.welcomeGl !== undefined
        ? body.welcomeGl.slice(0, 500)
        : muni.settings.welcomeGl,
    welcomeEs:
      body.welcomeEs !== undefined
        ? body.welcomeEs.slice(0, 500)
        : muni.settings.welcomeEs,
    logoDataUrl,
    legal,
    contact,
    openData,
    deputacionCanViewPersonalData,
  };
  await getDb()
    .update(t.municipalities)
    .set({ name, accentColor: brand, settings })
    .where(eq(t.municipalities.id, municipalityId));
  await audit(
    municipalityId,
    actor,
    "admin.branding.update",
    `${name}; brand=${brand}; logo=${logoDataUrl ? "yes" : "no"}; contrastOk=${checked.ok}${
      deputacionCanViewPersonalData !== prevDeputacionPii
        ? `; deputacionCanViewPersonalData=${deputacionCanViewPersonalData ? "true" : "false"}`
        : ""
    }`,
  );
  const updated = await getMunicipalityById(municipalityId);
  if (!updated) throw new Error("not_found");
  return {
    name: updated.name,
    theme: resolveTheme({
      accentColor: updated.accentColor,
      theme: updated.settings.theme,
    }),
    welcomeGl: updated.settings.welcomeGl ?? "",
    welcomeEs: updated.settings.welcomeEs ?? "",
    logoDataUrl: updated.settings.logoDataUrl ?? null,
    legal: updated.settings.legal ?? {},
    contact: updated.settings.contact ?? {},
    openData: updated.settings.openData ?? {
      license: "CC BY 4.0",
      dir3: "",
      catalogPublisher: "",
    },
    deputacionCanViewPersonalData:
      updated.settings.deputacionCanViewPersonalData === true,
    contrastOk: checked.ok,
    contrastRatio: checked.ratio,
  };
}

export async function putFacilityNormas(
  municipalityId: string,
  facilityId: string,
  actor: string,
  body: {
    rulesOverride?: Partial<UsageRules> | null;
    rulesText?: RulesTextItem[] | null;
  },
) {
  const facility = await getFacility(facilityId);
  if (!facility || facility.municipalityId !== municipalityId) {
    throw new Error("not_found");
  }
  const set: {
    rulesOverride?: Record<string, unknown> | null;
    rulesText?: RulesTextItem[] | null;
  } = {};
  if (body.rulesOverride !== undefined) {
    set.rulesOverride = body.rulesOverride as Record<string, unknown> | null;
  }
  if (body.rulesText !== undefined) set.rulesText = body.rulesText;
  if (Object.keys(set).length) {
    await getDb()
      .update(t.facilities)
      .set(set)
      .where(eq(t.facilities.id, facilityId));
  }
  const slotOverride = body.rulesOverride?.slotMinutes;
  if (typeof slotOverride === "number" && [30, 60, 90].includes(slotOverride)) {
    const units = await listUnits(facilityId);
    for (const u of units) {
      await updateUnitAdmin(municipalityId, facilityId, u.id, actor, {
        slotMinutes: slotOverride,
      });
    }
  }
  await audit(
    municipalityId,
    actor,
    "admin.facility_normas.update",
    facilityId,
  );
  return getNormas(municipalityId, facilityId);
}

/* ——— Instalacións ——— */

export async function listAdminFacilities(municipalityId: string) {
  const rows = await getDb()
    .select()
    .from(t.facilities)
    .where(eq(t.facilities.municipalityId, municipalityId));
  return Promise.all(
    rows.map(async (r) => {
      const f = mapFacility(r);
      const units = await listUnits(f.id);
      return { ...f, units };
    }),
  );
}

export async function createFacilityAdmin(
  municipalityId: string,
  actor: string,
  input: {
    name: string;
    type: FacilityType;
    address: string;
    lat?: number;
    lng?: number;
    accessibility?: string;
    services?: string[];
    rules?: string;
    courtCount?: number;
    halfCourts?: boolean;
    units?: Array<{
      name: string;
      bookingKind?: string;
      slotMinutes?: number;
      capacity?: number;
      incompatibleWith?: string[];
    }>;
  },
) {
  const {
    unitTemplatesForFacility,
    defaultRulesTextForType,
    defaultSlotMinutesForType,
    FACILITY_DRAFT_RULES,
    isPlaceholderCoords,
  } = await import("./facility-admin-templates.js");

  if (input.lat == null || input.lng == null) {
    throw new Error("coords_required");
  }
  if (isPlaceholderCoords(input.lat, input.lng)) {
    throw new Error("coords_required");
  }

  const id = nid("fac");
  const db = getDb();
  const nameTrim = input.name.trim();
  /* REVISION-31 B8: non duplicar nome de instalación no mesmo concello. */
  const sameName = await db
    .select({ id: t.facilities.id })
    .from(t.facilities)
    .where(
      and(
        eq(t.facilities.municipalityId, municipalityId),
        sql`lower(${t.facilities.name}) = ${nameTrim.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (sameName[0]) throw new Error("name_taken");

  const rulesText = defaultRulesTextForType(
    input.type,
    input.halfCourts === true,
  );
  const outdoorDefault =
    input.type === "pista" || input.type === "campo";
  await db.insert(t.facilities).values({
    id,
    municipalityId,
    name: nameTrim,
    type: input.type,
    address: input.address,
    lat: String(input.lat),
    lng: String(input.lng),
    accessibility: input.accessibility ?? "",
    services: input.services ?? [],
    rules: input.rules ?? FACILITY_DRAFT_RULES,
    rulesText,
    active: false,
    outdoor: outdoorDefault,
  });

  type UnitSeed = {
    name: string;
    bookingKind?: string;
    slotMinutes?: number;
    capacity?: number;
    incompatibleWith?: string[];
    key?: string;
    incompatibleKeys?: string[];
  };

  let unitInputs: UnitSeed[] = input.units ?? [];
  if (unitInputs.length === 0) {
    const templates = unitTemplatesForFacility(
      input.type,
      input.courtCount ?? 1,
      input.halfCourts === true,
    );
    unitInputs = templates.map((tpl) => ({
      name: tpl.name,
      bookingKind: tpl.bookingKind,
      slotMinutes: tpl.slotMinutes ?? defaultSlotMinutesForType(input.type),
      capacity: tpl.capacity ?? 4,
      key: tpl.key,
      incompatibleKeys: tpl.incompatibleKeys,
    }));
  }

  const keyToId = new Map<string, string>();
  for (const u of unitInputs) {
    const uid = nid("unit");
    const slotMinutes = u.slotMinutes ?? defaultSlotMinutesForType(input.type);
    await db.insert(t.units).values({
      id: uid,
      facilityId: id,
      municipalityId,
      name: u.name,
      incompatibleWith: u.incompatibleWith ?? [],
      bookingKind: u.bookingKind ?? "ambas",
      slotMinutes,
      capacity: u.capacity ?? 4,
      active: false,
    });
    if (u.key) keyToId.set(u.key, uid);
    await seedDefaultHoursAndSlots(
      municipalityId,
      id,
      uid,
      slotMinutes,
      input.type,
    );
  }

  for (const u of unitInputs) {
    const uid = u.key ? keyToId.get(u.key) : undefined;
    if (!uid || !u.incompatibleKeys?.length) continue;
    const incompatibleWith = u.incompatibleKeys
      .map((k: string) => keyToId.get(k))
      .filter((x): x is string => !!x);
    if (incompatibleWith.length) {
      await db
        .update(t.units)
        .set({ incompatibleWith })
        .where(eq(t.units.id, uid));
    }
  }

  await audit(municipalityId, actor, "admin.facility.create", `${input.name} (${id})`);
  const f = await getFacility(id);
  return { ...f!, units: await listUnits(id) };
}

/** REVISION-29 §3.7 I2 — publicar instalación borrador (activa instalación e unidades). */
export async function publishFacilityAdmin(
  municipalityId: string,
  facilityId: string,
  actor: string,
) {
  const existing = await getFacility(facilityId);
  if (!existing || existing.municipalityId !== municipalityId) {
    throw new Error("not_found");
  }
  const { isPlaceholderCoords } = await import("./facility-admin-templates.js");
  const lat = Number(existing.lat);
  const lng = Number(existing.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || isPlaceholderCoords(lat, lng)) {
    throw new Error("coords_required");
  }
  const units = await listUnits(facilityId);
  if (units.length === 0) throw new Error("no_units");
  const db = getDb();
  /* REVISION-30 Z2: ao publicar limpa o texto de borrador. */
  const nextRules = /borrador/i.test(existing.rules ?? "")
    ? ""
    : (existing.rules ?? "");
  await db
    .update(t.facilities)
    .set({ active: true, rules: nextRules })
    .where(eq(t.facilities.id, facilityId));
  for (const u of units) {
    await db.update(t.units).set({ active: true }).where(eq(t.units.id, u.id));
  }
  await audit(municipalityId, actor, "admin.facility.publish", facilityId);
  return { ...(await getFacility(facilityId))!, units: await listUnits(facilityId) };
}

/** REVISION-29 §3.7 I7 — copiar horario da unidade a todas as do mesmo recinto. */
export async function applyOpeningHoursToFacilityUnits(
  municipalityId: string,
  actor: string,
  input: { facilityId: string; sourceUnitId: string },
) {
  const units = await listUnits(input.facilityId);
  const source = units.find((u) => u.id === input.sourceUnitId);
  if (!source || source.municipalityId !== municipalityId) throw new Error("not_found");
  const hours = await listOpeningHours(municipalityId, input.sourceUnitId);
  if (hours.length === 0) throw new Error("no_hours");
  const payload = hours.map((h) => ({
    weekday: h.weekday,
    open: h.open,
    close: h.close,
    validFrom: h.validFrom,
    validTo: h.validTo,
  }));
  for (const u of units) {
    if (u.id === input.sourceUnitId) continue;
    await upsertOpeningHours(municipalityId, actor, {
      unitId: u.id,
      facilityId: input.facilityId,
      hours: payload,
    });
  }
  await audit(
    municipalityId,
    actor,
    "admin.horarios.apply_all",
    `${input.sourceUnitId} → ${units.length - 1} unidades`,
  );
  return { applied: units.length - 1 };
}

/** REVISION-28 §3.7 — reservas/partidos futuros se desactiva a instalación (informativo). */
export async function previewFacilityDeactivateImpact(
  municipalityId: string,
  facilityId: string,
) {
  const existing = await getFacility(facilityId);
  if (!existing || existing.municipalityId !== municipalityId) {
    throw new Error("not_found");
  }
  const { localDateIso, addDaysIso, DEFAULT_TIMEZONE } = await import(
    "./business-rules.js"
  );
  const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
  const end = addDaysIso(today, 365);
  return previewClosureImpact(municipalityId, {
    facilityId,
    startsAt: `${today}T00:00`,
    endsAt: `${end}T23:59`,
  });
}

export async function updateFacilityAdmin(
  municipalityId: string,
  facilityId: string,
  actor: string,
  patch: Partial<{
    name: string;
    type: FacilityType;
    address: string;
    lat: number;
    lng: number;
    accessibility: string;
    services: string[];
    rules: string;
    active: boolean;
    outdoor: boolean;
    imageDataUrl: string | null;
    imageAlt: string | null;
    checkInRequired: boolean;
    contactPhone: string | null;
    contactEmail: string | null;
    contactPerson: string | null;
    parkingInfo: string | null;
    publicTransport: string | null;
    entranceInfo: string | null;
  }>,
) {
  const existing = await getFacility(facilityId);
  if (!existing || existing.municipalityId !== municipalityId) {
    throw new Error("not_found");
  }
  const set: Record<string, unknown> = {};
  const trimOrNull = (v: string | null | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const t = v.trim();
    return t ? t.slice(0, 200) : null;
  };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.address !== undefined) set.address = patch.address;
  if (patch.lat !== undefined) set.lat = String(patch.lat);
  if (patch.lng !== undefined) set.lng = String(patch.lng);
  if (patch.accessibility !== undefined) {
    const a = patch.accessibility.trim().slice(0, 200);
    set.accessibility = a;
  }
  if (patch.services !== undefined) set.services = patch.services;
  if (patch.rules !== undefined) set.rules = patch.rules;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.outdoor !== undefined) set.outdoor = patch.outdoor;
  if (patch.checkInRequired !== undefined) set.checkInRequired = patch.checkInRequired;
  if (patch.contactPhone !== undefined) {
    set.contactPhone = patch.contactPhone?.trim() || null;
  }
  if (patch.contactEmail !== undefined) {
    set.contactEmail = patch.contactEmail?.trim() || null;
  }
  if (patch.contactPerson !== undefined) {
    set.contactPerson = patch.contactPerson?.trim() || null;
  }
  if (patch.parkingInfo !== undefined) {
    set.parkingInfo = trimOrNull(patch.parkingInfo);
  }
  if (patch.publicTransport !== undefined) {
    set.publicTransport = trimOrNull(patch.publicTransport);
  }
  if (patch.entranceInfo !== undefined) {
    set.entranceInfo = trimOrNull(patch.entranceInfo);
  }
  if (patch.imageDataUrl !== undefined) {
    if (patch.imageDataUrl === null || patch.imageDataUrl === "") {
      set.imageDataUrl = null;
    } else {
      const { normalizeFacilityImage } = await import("./facility-image.js");
      set.imageDataUrl = await normalizeFacilityImage(patch.imageDataUrl);
    }
  }
  if (patch.imageAlt !== undefined) {
    set.imageAlt = trimOrNull(patch.imageAlt)?.slice(0, 200) ?? null;
  }
  if (Object.keys(set).length) {
    await getDb()
      .update(t.facilities)
      .set(set)
      .where(eq(t.facilities.id, facilityId));
  }
  await audit(
    municipalityId,
    actor,
    patch.active === false ? "admin.facility.deactivate" : "admin.facility.update",
    facilityId,
  );
  return { ...(await getFacility(facilityId))!, units: await listUnits(facilityId) };
}

export async function createUnitAdmin(
  municipalityId: string,
  facilityId: string,
  actor: string,
  input: {
    name: string;
    bookingKind?: string;
    slotMinutes?: number;
    capacity?: number;
    incompatibleWith?: string[];
  },
) {
  const f = await getFacility(facilityId);
  if (!f || f.municipalityId !== municipalityId) throw new Error("not_found");
  const id = nid("unit");
  const slotMinutes = input.slotMinutes ?? 60;
  await getDb().insert(t.units).values({
    id,
    facilityId,
    municipalityId,
    name: input.name,
    incompatibleWith: input.incompatibleWith ?? [],
    bookingKind: input.bookingKind ?? "ambas",
    slotMinutes,
    capacity: input.capacity ?? 4,
    active: true,
  });
  await seedDefaultHoursAndSlots(municipalityId, facilityId, id, slotMinutes);
  await audit(municipalityId, actor, "admin.unit.create", `${input.name} (${id})`);
  const rows = await getDb().select().from(t.units).where(eq(t.units.id, id)).limit(1);
  return mapUnit(rows[0]!);
}

export async function updateUnitAdmin(
  municipalityId: string,
  facilityId: string,
  unitId: string,
  actor: string,
  patch: Partial<{
    name: string;
    bookingKind: string;
    slotMinutes: number;
    capacity: number;
    incompatibleWith: string[];
    active: boolean;
  }>,
) {
  const rows = await getDb()
    .select()
    .from(t.units)
    .where(
      and(
        eq(t.units.id, unitId),
        eq(t.units.facilityId, facilityId),
        eq(t.units.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error("not_found");
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.bookingKind !== undefined) set.bookingKind = patch.bookingKind;
  if (patch.slotMinutes !== undefined) set.slotMinutes = patch.slotMinutes;
  if (patch.capacity !== undefined) set.capacity = patch.capacity;
  if (patch.incompatibleWith !== undefined) set.incompatibleWith = patch.incompatibleWith;
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length) {
    await getDb().update(t.units).set(set).where(eq(t.units.id, unitId));
  }
  if (patch.slotMinutes !== undefined) {
    await regenerateSlotsForUnit(municipalityId, unitId, patch.slotMinutes);
  }
  await audit(municipalityId, actor, "admin.unit.update", unitId);
  const updated = await getDb().select().from(t.units).where(eq(t.units.id, unitId)).limit(1);
  return mapUnit(updated[0]!);
}

/**
 * Horario por defecto L–V 09–13 e 16–21; xera franxas 14 días.
 * REVISION-30 Z14: pavillón tamén sábados e domingos (uso de fin de semana).
 */
async function seedDefaultHoursAndSlots(
  municipalityId: string,
  facilityId: string,
  unitId: string,
  slotMinutes: number,
  facilityType?: string,
) {
  const db = getDb();
  const blocks = [
    { open: "09:00", close: "13:00" },
    { open: "16:00", close: "21:00" },
  ];
  const weekdays =
    facilityType === "pavillon" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  for (const weekday of weekdays) {
    for (const b of blocks) {
      await db.insert(t.openingHours).values({
        id: nid("oh"),
        municipalityId,
        facilityId,
        unitId,
        weekday,
        open: b.open,
        close: b.close,
      });
    }
  }
  await regenerateSlotsForUnit(municipalityId, unitId, slotMinutes);
}

function hhmmToMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minToHhmm(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function regenerateSlotsForUnit(
  municipalityId: string,
  unitId: string,
  slotMinutes = 60,
  days = 14,
) {
  /* REVISION-20 H1: mesma lóxica que o job diario (peches, partidos, tempada). */
  return regenerateSlotsForUnitAhead(municipalityId, unitId, {
    slotMinutes,
    days,
    pruneOrphans: true,
  });
}

/* ——— Horarios ——— */

export async function listOpeningHours(municipalityId: string, unitId?: string) {
  const rows = await getDb()
    .select()
    .from(t.openingHours)
    .where(
      unitId
        ? and(
            eq(t.openingHours.municipalityId, municipalityId),
            eq(t.openingHours.unitId, unitId),
          )
        : eq(t.openingHours.municipalityId, municipalityId),
    );
  return rows.map((r) => ({
    id: r.id,
    facilityId: r.facilityId,
    unitId: r.unitId,
    weekday: r.weekday,
    open: r.open,
    close: r.close,
    validFrom: r.validFrom,
    validTo: r.validTo,
  }));
}

/** HH:MM → minutos desde medianoite. */
function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

type OpeningHourInput = {
  weekday: number;
  open: string;
  close: string;
  validFrom?: string | null;
  validTo?: string | null;
};

function rangeKey(h: OpeningHourInput): string {
  return `${h.validFrom ?? ""}|${h.validTo ?? ""}`;
}

/** Valida tramos: open < close e sen solapes no mesmo día (por período). */
export function validateOpeningHoursNoOverlap(hours: OpeningHourInput[]): void {
  for (const h of hours) {
    if (h.validFrom && h.validTo && h.validFrom > h.validTo) {
      throw new Error("invalid_range");
    }
  }
  const byGroup = new Map<string, Array<{ open: string; close: string }>>();
  for (const h of hours) {
    if (timeToMinutes(h.open) >= timeToMinutes(h.close)) {
      throw new Error("invalid_range");
    }
    const key = `${rangeKey(h)}|${h.weekday}`;
    const list = byGroup.get(key) ?? [];
    list.push({ open: h.open, close: h.close });
    byGroup.set(key, list);
  }
  for (const [, list] of byGroup) {
    const sorted = [...list].sort((a, b) => a.open.localeCompare(b.open));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (timeToMinutes(cur.open) < timeToMinutes(prev.close)) {
        throw new Error("hours_overlap");
      }
    }
  }
}

function hoursForDate(
  hours: Array<{
    weekday: number;
    open: string;
    close: string;
    validFrom: string | null;
    validTo: string | null;
  }>,
  date: string,
  weekday: number,
) {
  const special = hours.filter(
    (h) =>
      h.weekday === weekday &&
      h.validFrom &&
      h.validTo &&
      date >= h.validFrom &&
      date <= h.validTo,
  );
  if (special.length > 0) return special;
  return hours.filter(
    (h) => h.weekday === weekday && !h.validFrom && !h.validTo,
  );
}

export async function upsertOpeningHours(
  municipalityId: string,
  actor: string,
  body: {
    unitId: string;
    facilityId?: string;
    hours: OpeningHourInput[];
  },
) {
  const unitRows = await getDb()
    .select()
    .from(t.units)
    .where(
      and(eq(t.units.id, body.unitId), eq(t.units.municipalityId, municipalityId)),
    )
    .limit(1);
  const unit = unitRows[0];
  if (!unit) throw new Error("not_found");
  const facilityId = body.facilityId ?? unit.facilityId;

  validateOpeningHoursNoOverlap(body.hours);

  await getDb()
    .delete(t.openingHours)
    .where(
      and(
        eq(t.openingHours.municipalityId, municipalityId),
        eq(t.openingHours.unitId, body.unitId),
      ),
    );

  for (const h of body.hours) {
    const validFrom = h.validFrom?.trim() || null;
    const validTo = h.validTo?.trim() || null;
    await getDb().insert(t.openingHours).values({
      id: nid("oh"),
      municipalityId,
      facilityId,
      unitId: body.unitId,
      weekday: h.weekday,
      open: h.open,
      close: h.close,
      validFrom,
      validTo,
    });
  }
  await regenerateSlotsForUnit(
    municipalityId,
    body.unitId,
    unit.slotMinutes ?? 60,
  );
  await audit(
    municipalityId,
    actor,
    "admin.horarios.update",
    `${body.unitId}: ${body.hours.length} tramos`,
  );
  return listOpeningHours(municipalityId, body.unitId);
}

/* ——— Peches ——— */

export async function listClosures(municipalityId: string) {
  const rows = await getDb()
    .select()
    .from(t.closures)
    .where(eq(t.closures.municipalityId, municipalityId));
  return rows.map((r) => ({
    id: r.id,
    facilityId: r.facilityId,
    unitId: r.unitId,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    reason: r.reason,
    notifyCitizens: r.notifyCitizens,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** REVISION-51 C2 — peches activos + próximos 14 días dunha instalación. */
export async function upcomingClosuresForFacility(
  municipalityId: string,
  facilityId: string,
  opts?: { fromDate?: string; daysAhead?: number },
): Promise<
  Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string;
    facilityId: string | null;
    unitId: string | null;
  }>
> {
  const muni = await getMunicipalityById(municipalityId);
  const tz = (muni?.settings as { timezone?: string } | undefined)?.timezone ?? DEFAULT_TIMEZONE;
  const fromDate = opts?.fromDate ?? localDateIso(new Date(), tz);
  const daysAhead = opts?.daysAhead ?? 14;
  const untilDate = addDaysIso(fromDate, daysAhead);
  /* REVISION-56 H2: solape por data+hora (non só a data). */
  const windowStart = opts?.fromDate
    ? parseLocalDateTime(`${fromDate}T00:00`, tz).getTime()
    : Date.now();
  const windowEnd = parseLocalDateTime(`${untilDate}T23:59`, tz).getTime();
  const rows = await listClosures(municipalityId);
  return rows
    .filter((r) => !r.facilityId || r.facilityId === facilityId)
    .filter((r) => {
      const cStart = parseLocalDateTime(r.startsAt, tz).getTime();
      const cEnd = parseLocalDateTime(r.endsAt, tz).getTime();
      return cStart < windowEnd && windowStart < cEnd;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((r) => ({
      id: r.id,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      reason: r.reason,
      facilityId: r.facilityId,
      unitId: r.unitId,
    }));
}

/** Festivos nacionais + galegos 2026/2027 (C3 / REVISION-52 X1). */
export { GALICIA_HOLIDAYS_2026_2027 } from "@pista-aberta/shared";


export type ClosureMode = "cancel_notify" | "skip_booked_days";

export async function previewClosureImpact(
  municipalityId: string,
  input: {
    facilityId?: string;
    unitId?: string;
    startsAt: string;
    endsAt: string;
  },
) {
  const bounds = normalizeClosureBound(input.startsAt, input.endsAt);
  const startDate = bounds.startsAt.slice(0, 10);
  const endDate = bounds.endsAt.slice(0, 10);
  const muni = await getMunicipalityById(municipalityId);
  const tz =
    (muni?.settings as { timezone?: string } | undefined)?.timezone ??
    DEFAULT_TIMEZONE;
  let unitIds: string[] | null = null;
  if (input.unitId) unitIds = [input.unitId];
  else if (input.facilityId) {
    const us = await listUnits(input.facilityId);
    unitIds = us.map((u) => u.id);
  }
  const bookings = await getDb()
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, municipalityId),
        notInArray(t.bookings.status, ["cancelled", "no_show"]),
        gte(t.bookings.date, startDate),
        lte(t.bookings.date, endDate),
      ),
    );
  /* REVISION-56 H2: só reservas cuxa franxa solapa [startsAt, endsAt). */
  const affected = bookings.filter((b) => {
    if (unitIds && !unitIds.includes(b.unitId)) return false;
    return slotOverlapsClosureRange(
      b.date,
      b.start,
      b.end,
      bounds.startsAt,
      bounds.endsAt,
      tz,
    );
  });
  const peopleCount = new Set(affected.map((b) => b.userId)).size;
  const bookedDates = [...new Set(affected.map((b) => b.date))].sort();

  const matchRows = await getDb()
    .select()
    .from(t.matches)
    .where(
      and(
        eq(t.matches.municipalityId, municipalityId),
        gte(t.matches.date, startDate),
        lte(t.matches.date, endDate),
        ne(t.matches.status, "cancelled"),
      ),
    );
  const matches = matchRows.filter((m) => {
    if (input.facilityId && m.facilityId !== input.facilityId) return false;
    if (unitIds && !unitIds.includes(m.unitId)) return false;
    /* «Aprobados» = activos (non cancelados / rexeitados). */
    if (
      !["scheduled", "resolved", "swapped", "moved", "approved", "conflict"].includes(
        m.status,
      )
    ) {
      return false;
    }
    return slotOverlapsClosureRange(
      m.date,
      m.start,
      m.end,
      input.startsAt,
      input.endsAt,
      tz,
    );
  });

  const { listOpenMatchesInRange } = await import("./open-matches.js");
  const openRowsRaw = await listOpenMatchesInRange({
    municipalityId,
    startDate,
    endDate,
    facilityId: input.facilityId,
    unitIds,
  });
  const openRows = openRowsRaw.filter((m) =>
    slotOverlapsClosureRange(
      m.date,
      m.start,
      m.end,
      input.startsAt,
      input.endsAt,
      tz,
    ),
  );
  const openPlayerRows = openRows.length
    ? await getDb()
        .select({ userId: t.openMatchPlayers.userId })
        .from(t.openMatchPlayers)
        .where(
          sql`${t.openMatchPlayers.openMatchId} in (${sql.join(
            openRows.map((r) => sql`${r.id}`),
            sql`, `,
          )})`,
        )
    : [];
  const peopleWithOpen = new Set([
    ...affected.map((b) => b.userId),
    ...openPlayerRows.map((p) => p.userId),
  ]).size;

  const matchDates = [
    ...new Set([...matches.map((m) => m.date), ...openRows.map((m) => m.date)]),
  ].sort();
  const occupiedDates = [...new Set([...bookedDates, ...matchDates])].sort();

  return {
    cancelledCount: affected.length,
    peopleCount: peopleWithOpen,
    matchCount: matches.length + openRows.length,
    matchIds: [...matches.map((m) => m.id), ...openRows.map((m) => m.id)],
    bookingIds: affected.map((b) => b.id),
    bookedDates,
    matchDates,
    occupiedDates,
  };
}

function eachDateInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

/** REVISION-57 J1 — unidades afectadas por un peche (para rexenerar franxas). */
async function unitIdsAffectedByClosure(
  municipalityId: string,
  scope: { facilityId?: string | null; unitId?: string | null },
): Promise<string[]> {
  if (scope.unitId) {
    const rows = await getDb()
      .select({ id: t.units.id })
      .from(t.units)
      .where(
        and(
          eq(t.units.id, scope.unitId),
          eq(t.units.municipalityId, municipalityId),
        ),
      );
    if (!rows[0]) return [];
    /* REVISION-58 K1: unidade + incompatibles (incompatibleWith e quen a lista). */
    return [...(await unitConflictSet(scope.unitId))];
  }
  if (scope.facilityId) {
    return (await listUnits(scope.facilityId)).map((u) => u.id);
  }
  const rows = await getDb()
    .select({ id: t.units.id })
    .from(t.units)
    .where(eq(t.units.municipalityId, municipalityId));
  return rows.map((r) => r.id);
}

async function regenerateUnitsAfterClosure(
  municipalityId: string,
  scopes: Array<{ facilityId?: string | null; unitId?: string | null }>,
): Promise<void> {
  const ids = new Set<string>();
  for (const scope of scopes) {
    for (const uid of await unitIdsAffectedByClosure(municipalityId, scope)) {
      ids.add(uid);
    }
  }
  const muni = await getMunicipalityById(municipalityId);
  const antelation = Math.max(
    1,
    (muni?.settings as { bookingAntelationDays?: number } | undefined)
      ?.bookingAntelationDays ?? 7,
  );
  /* Cobrir a antelación (+marxe); en test o default de slots-ahead é só 2 días. */
  const days = Math.max(antelation + 1, 16);
  for (const uid of ids) {
    await regenerateSlotsForUnitAhead(municipalityId, uid, { days }).catch(
      (err) => {
        console.warn("[slots-ahead] regenerate after closure failed", uid, err);
      },
    );
  }
}

export async function createClosureAdmin(
  municipalityId: string,
  actor: string,
  input: {
    facilityId?: string;
    unitId?: string;
    startsAt: string;
    endsAt: string;
    reason: string;
    notifyCitizens?: boolean;
    confirm?: boolean;
    /** cancel_notify (defecto ao confirmar) | skip_booked_days */
    mode?: ClosureMode;
    /** Motivo que lles chega ás persoas (distinto do motivo interno). */
    notifyReason?: string;
  },
) {
  /* REVISION-57 J2: normalizar data-só e rexeitar formatos raros. */
  const bounds = normalizeClosureBound(input.startsAt, input.endsAt);
  input = { ...input, startsAt: bounds.startsAt, endsAt: bounds.endsAt };

  /* REVISION-53 D3: facility/unit inexistentes → 404 específicos (non 500). */
  if (input.facilityId) {
    const facility = await getFacility(input.facilityId);
    if (!facility || facility.municipalityId !== municipalityId) {
      throw new Error("facility_not_found");
    }
    if (input.unitId) {
      const units = await listUnits(input.facilityId);
      if (
        !units.some(
          (u) => u.id === input.unitId && u.municipalityId === municipalityId,
        )
      ) {
        throw new Error("unit_not_found");
      }
    }
  } else if (input.unitId) {
    const unitRows = await getDb()
      .select()
      .from(t.units)
      .where(eq(t.units.id, input.unitId))
      .limit(1);
    const unitRow = unitRows[0];
    if (!unitRow || unitRow.municipalityId !== municipalityId) {
      throw new Error("unit_not_found");
    }
  }
  let impact = await previewClosureImpact(municipalityId, input);
  const mode: ClosureMode = input.mode ?? "cancel_notify";
  if (
    (impact.cancelledCount > 0 || impact.matchCount > 0) &&
    !input.confirm
  ) {
    return { needsConfirm: true as const, ...impact };
  }

  const startDate = input.startsAt.slice(0, 10);
  const endDate = input.endsAt.slice(0, 10);
  let unitFilter: string[] | null = null;
  if (input.unitId) unitFilter = [input.unitId];
  else if (input.facilityId) {
    unitFilter = (await listUnits(input.facilityId)).map((u) => u.id);
  }

  /* REVISION-23 R7: «só días sen reservas» salta tamén días con partidos. */
  const occupiedSet = new Set(impact.occupiedDates ?? impact.bookedDates);
  const freeDays =
    mode === "skip_booked_days"
      ? eachDateInclusive(startDate, endDate).filter((d) => !occupiedSet.has(d))
      : eachDateInclusive(startDate, endDate);

  if (mode === "skip_booked_days" && freeDays.length === 0) {
    await audit(
      municipalityId,
      actor,
      "admin.closure.create",
      `${startDate}→${endDate}: skip_booked_days sen días libres`,
    );
    return {
      needsConfirm: false as const,
      id: null as string | null,
      ids: [] as string[],
      skipped: true as const,
      ...impact,
      cancelledCount: 0,
      bookingIds: [] as string[],
    };
  }

  const closureRanges: Array<{ startsAt: string; endsAt: string }> =
    mode === "skip_booked_days"
      ? freeDays.map((d) => ({
          startsAt: `${d}T00:00`,
          endsAt: `${d}T23:59`,
        }))
      : [
          {
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
        ];

  const ids: string[] = [];
  const operationKey = `closure:${nid("op")}`;

  const slotDates =
    mode === "skip_booked_days" ? freeDays : eachDateInclusive(startDate, endDate);
  let slots = await getDb()
    .select()
    .from(t.timeSlots)
    .where(
      and(
        eq(t.timeSlots.municipalityId, municipalityId),
        gte(t.timeSlots.date, startDate),
        lte(t.timeSlots.date, endDate),
      ),
    );

  const freeSet = new Set(slotDates);
  const muniForTz = await getMunicipalityById(municipalityId);
  const closureTz =
    (muniForTz?.settings as { timezone?: string } | undefined)?.timezone ??
    DEFAULT_TIMEZONE;

  let cancelled = 0;
  let matchesCancelled = 0;
  await getDb().transaction(async (tx) => {
    const facilityIds = input.facilityId
      ? [input.facilityId]
      : input.unitId
        ? (
            await tx
              .select({ facilityId: t.units.facilityId })
              .from(t.units)
              .where(eq(t.units.id, input.unitId))
              .limit(1)
          ).map((row) => row.facilityId)
        : (
            await tx
              .select({ id: t.facilities.id })
              .from(t.facilities)
              .where(eq(t.facilities.municipalityId, municipalityId))
          ).map((row) => row.id);
    await lockBookingResources(tx, { facilityIds });

    /*
     * A previsualización previa só pide confirmación. Tras o lock da
     * instalación recollemos de novo coa MESMA transacción (nunca getDb()):
     * en PGlite unha consulta fóra do tx coa conexión ocupada queda en
     * deadlock. Así unha reserva que gañase a carreira tamén se cancela e
     * unha que perdeu ve a franxa xa pechada.
     */
    const lockedBookings = await tx
      .select()
      .from(t.bookings)
      .where(
        and(
          eq(t.bookings.municipalityId, municipalityId),
          notInArray(t.bookings.status, ["cancelled", "no_show"]),
          gte(t.bookings.date, startDate),
          lte(t.bookings.date, endDate),
        ),
      );
    const affectedUnderLock = lockedBookings.filter((b) => {
      if (unitFilter && !unitFilter.includes(b.unitId)) return false;
      return slotOverlapsClosureRange(
        b.date,
        b.start,
        b.end,
        input.startsAt,
        input.endsAt,
        closureTz,
      );
    });
    impact = {
      ...impact,
      cancelledCount: affectedUnderLock.length,
      peopleCount: new Set(affectedUnderLock.map((b) => b.userId).filter(Boolean))
        .size,
      bookingIds: affectedUnderLock.map((b) => b.id),
      bookedDates: [...new Set(affectedUnderLock.map((b) => b.date))].sort(),
      occupiedDates: [
        ...new Set([
          ...affectedUnderLock.map((b) => b.date),
          ...(impact.matchDates ?? []),
        ]),
      ].sort(),
    };
    await lockBookingResources(tx, {
      userIds: affectedUnderLock.map((booking) => booking.userId),
    });
    slots = await tx
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.municipalityId, municipalityId),
          gte(t.timeSlots.date, startDate),
          lte(t.timeSlots.date, endDate),
        ),
      );

    for (const range of closureRanges) {
      const id = nid("cl");
      ids.push(id);
      await tx.insert(t.closures).values({
        id,
        municipalityId,
        facilityId: input.facilityId ?? null,
        unitId: input.unitId ?? null,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        reason: input.reason,
        notifyCitizens: input.notifyCitizens !== false,
      });
    }

    for (const s of slots) {
      if (unitFilter && !unitFilter.includes(s.unitId)) continue;
      if (!freeSet.has(s.date)) continue;
      const rangeStarts =
        mode === "skip_booked_days" ? `${s.date}T00:00` : input.startsAt;
      const rangeEnds =
        mode === "skip_booked_days" ? `${s.date}T23:59` : input.endsAt;
      if (
        !slotOverlapsClosureRange(
          s.date,
          s.start,
          s.end,
          rangeStarts,
          rangeEnds,
          closureTz,
        )
      ) {
        continue;
      }
      await tx
        .update(t.timeSlots)
        .set({ closed: true, closedReason: input.reason })
        .where(eq(t.timeSlots.id, s.id));
    }

  if (mode === "cancel_notify") {
    const citizenMsg = (input.notifyReason?.trim() || input.reason).trim();

    for (const bid of impact.bookingIds) {
      const b = (
        await tx.select().from(t.bookings).where(eq(t.bookings.id, bid)).limit(1)
      )[0];
      if (!b) continue;
      const changed = await tx
        .update(t.bookings)
        .set({ status: "cancelled", cancelReason: citizenMsg })
        .where(
          and(
            eq(t.bookings.id, bid),
            inArray(t.bookings.status, ["confirmed", "pending"]),
          ),
        )
        .returning();
      if (changed.length === 0) continue;
      cancelled += 1;
      if (b.userId && input.notifyCitizens !== false) {
        {
          /*
           * Só consultas sobre `tx`: getFacility/listSlots/listUnits usan
           * getDb() e en PGlite bloquearían a conexión da transacción.
           * As alternativas calcúlanse sen saír do tx (consulta directa).
           */
          const fac = (
            await tx
              .select()
              .from(t.facilities)
              .where(eq(t.facilities.id, b.facilityId))
              .limit(1)
          )[0];
          const units = await tx
            .select()
            .from(t.units)
            .where(eq(t.units.facilityId, b.facilityId));
          const unitName = units.find((u) => u.id === b.unitId)?.name;
          /* Alternativas baleiras no TX; enrichClosureOutboxAlternatives post-commit. */
          const alts: ClosureAlternative[] = [];
          await enqueueUserNotice(
            tx,
            `${operationKey}:booking:${b.id}`,
            municipalityId,
            {
              operationKey,
              notice: {
                id: nid("n-cl"),
                municipalityId,
                userId: b.userId,
                noticeType: "closure",
                notifyType: "cancelacion",
                title: "Peche de instalación",
                body: `A túa reserva do ${formatDayChip(b.date, "gl")} · ${b.start}–${b.end} foi cancelada: ${citizenMsg}`,
                email: {
                  kind: "facility_closure",
                  data: {
                    sport: fac?.name ?? "Deporte",
                    facilityName: fac?.name ?? "Instalación",
                    facilityId: b.facilityId,
                    facilityAddress: fac?.address,
                    unitName,
                    dayLabel: formatDayChip(b.date, "gl"),
                    timeLabel: `${b.start}–${b.end}`,
                    date: b.date,
                    start: b.start,
                    end: b.end,
                    bookingId: b.id,
                    icsSequence: b.icsSequence ?? 0,
                    reason: citizenMsg,
                    alternatives: alts,
                  },
                },
              },
            },
          );
        }
      }
    }

    /* REVISION-34 E3: cancelar partidos e un só correo por club (todos os afectados). */
    type MatchMail = {
      clubId: string;
      clubName: string;
      items: Array<{
        dayLabel: string;
        timeLabel: string;
        rival?: string;
        courtName?: string;
        date: string;
        start: string;
        end: string;
      }>;
      userIds: Set<string>;
    };
    const byClub = new Map<string, MatchMail>();

    for (const midMatch of impact.matchIds ?? []) {
      const mrow = (
        await tx
          .select()
          .from(t.matches)
          .where(eq(t.matches.id, midMatch))
          .limit(1)
      )[0];
      if (!mrow) continue;
      const note = `Cancelado polo peche: ${citizenMsg}`;
      await tx
        .update(t.matches)
        .set({
          status: "cancelled",
          notes: mrow.notes ? `${mrow.notes}\n${note}` : note,
        })
        .where(eq(t.matches.id, midMatch));
      matchesCancelled += 1;

      const clubRows = await tx
        .select()
        .from(t.clubs)
        .where(eq(t.clubs.id, mrow.clubId))
        .limit(1);
      const home = (
        await tx.select().from(t.teams).where(eq(t.teams.id, mrow.homeTeamId)).limit(1)
      )[0];
      const away = (
        await tx.select().from(t.teams).where(eq(t.teams.id, mrow.awayTeamId)).limit(1)
      )[0];
      const units = await tx
        .select()
        .from(t.units)
        .where(eq(t.units.facilityId, mrow.facilityId));
      const courtName = units.find((u) => u.id === mrow.unitId)?.name;
      const clubUsers = await tx
        .select()
        .from(t.users)
        .where(
          and(
            eq(t.users.municipalityId, municipalityId),
            eq(t.users.clubId, mrow.clubId),
          ),
        );

      let bucket = byClub.get(mrow.clubId);
      if (!bucket) {
        bucket = {
          clubId: mrow.clubId,
          clubName: clubRows[0]?.name ?? "Club",
          items: [],
          userIds: new Set(),
        };
        byClub.set(mrow.clubId, bucket);
      }
      bucket.items.push({
        dayLabel: formatDayChip(mrow.date, "gl"),
        timeLabel: `${mrow.start}–${mrow.end}`,
        rival: away?.name ?? home?.name,
        courtName,
        date: mrow.date,
        start: mrow.start,
        end: mrow.end,
      });
      for (const cu of clubUsers) bucket.userIds.add(cu.id);
    }

    for (const bucket of byClub.values()) {
      for (const userId of bucket.userIds) {
        await enqueueUserNotice(
          tx,
          `${operationKey}:club:${bucket.clubId}:user:${userId}`,
          municipalityId,
          {
            operationKey,
            notice: {
              id: nid("n-cl-m"),
              municipalityId,
              userId,
              noticeType: "closure",
              notifyType: "partido_club",
              title: "Partido cancelado polo peche",
              body: `${bucket.items.length} partido(s) cancelados polo peche: ${citizenMsg}. Podes pedir un cambio desde o panel do club.`,
              email: {
                kind: "match_cancelled",
                data: {
                  clubName: bucket.clubName,
                  clubId: bucket.clubId,
                  dayLabel: bucket.items[0]?.dayLabel,
                  reason: citizenMsg,
                  matches: bucket.items,
                },
              },
            },
          },
        );
      }
    }
  }

    await tx.insert(t.auditEvents).values({
      id: nid("au"),
      municipalityId,
      at: new Date(),
      actor,
      action: "admin.closure.create",
      detail: `${startDate}→${endDate}: ${input.reason} mode=${mode} (${cancelled} canceladas, ${matchesCancelled} partidos, ${impact.peopleCount} persoas)`,
    });
  });
  if (mode === "cancel_notify") {
    await enrichClosureOutboxAlternatives(operationKey);
  }
  await drainNotificationOutboxSafely(operationKey);
  return {
    needsConfirm: false as const,
    id: ids[0] ?? null,
    ids,
    ...impact,
    cancelledCount: cancelled,
    matchesCancelled,
    bookingIds: mode === "cancel_notify" ? impact.bookingIds : [],
    matchIds: mode === "cancel_notify" ? (impact.matchIds ?? []) : [],
  };
}

export async function deleteClosureAdmin(
  municipalityId: string,
  closureId: string,
  actor: string,
) {
  const rows = await getDb()
    .select()
    .from(t.closures)
    .where(
      and(eq(t.closures.id, closureId), eq(t.closures.municipalityId, municipalityId)),
    )
    .limit(1);
  if (!rows[0]) throw new Error("not_found");
  const old = rows[0];
  await getDb().transaction(async (tx) => {
    await tx.delete(t.closures).where(eq(t.closures.id, closureId));
    await tx.insert(t.auditEvents).values({
      id: nid("au"),
      municipalityId,
      at: new Date(),
      actor,
      action: "admin.closure.delete",
      detail: closureId,
    });
  });
  /* REVISION-57 J1: rexenerar franxas do rango vello para reabrir. */
  await regenerateUnitsAfterClosure(municipalityId, [
    { facilityId: old.facilityId, unitId: old.unitId },
  ]);
  return { ok: true };
}

export async function updateClosureAdmin(
  municipalityId: string,
  closureId: string,
  actor: string,
  patch: {
    startsAt?: string;
    endsAt?: string;
    reason?: string;
    confirm?: boolean;
    mode?: ClosureMode;
    notifyReason?: string;
    notifyCitizens?: boolean;
  },
) {
  const rows = await getDb()
    .select()
    .from(t.closures)
    .where(
      and(eq(t.closures.id, closureId), eq(t.closures.municipalityId, municipalityId)),
    )
    .limit(1);
  if (!rows[0]) throw new Error("not_found");
  const old = rows[0];

  const nextStarts = patch.startsAt ?? old.startsAt;
  const nextEnds = patch.endsAt ?? old.endsAt;
  const bounds = normalizeClosureBound(nextStarts, nextEnds);
  const nextReason = patch.reason ?? old.reason;

  /* REVISION-57 J1: mesmo fluxo de impacto/confirmación ca ao crear. */
  const impact = await previewClosureImpact(municipalityId, {
    facilityId: old.facilityId ?? undefined,
    unitId: old.unitId ?? undefined,
    startsAt: bounds.startsAt,
    endsAt: bounds.endsAt,
  });
  const mode: ClosureMode = patch.mode ?? "cancel_notify";
  if (
    (impact.cancelledCount > 0 || impact.matchCount > 0) &&
    !patch.confirm
  ) {
    return { needsConfirm: true as const, ...impact };
  }

  const startDate = bounds.startsAt.slice(0, 10);
  const endDate = bounds.endsAt.slice(0, 10);
  /* REVISION-58 K6: skip_booked_days na edición (igual ca na creación). */
  if (mode === "skip_booked_days") {
    const occupiedSet = new Set(impact.occupiedDates ?? impact.bookedDates);
    const freeDays = eachDateInclusive(startDate, endDate).filter(
      (d) => !occupiedSet.has(d),
    );
    if (freeDays.length === 0) {
      await audit(
        municipalityId,
        actor,
        "admin.closure.update",
        `${closureId}: skip_booked_days sen días libres`,
      );
      return {
        needsConfirm: false as const,
        ...old,
        cancelledCount: 0,
        peopleCount: impact.peopleCount,
        matchCount: impact.matchCount,
        skipped: true as const,
      };
    }
    let firstId: string | null = null;
    await getDb().transaction(async (tx) => {
      await tx.delete(t.closures).where(eq(t.closures.id, closureId));
      for (const d of freeDays) {
        const id = nid("cl");
        if (!firstId) firstId = id;
        await tx.insert(t.closures).values({
          id,
          municipalityId,
          facilityId: old.facilityId,
          unitId: old.unitId,
          startsAt: `${d}T00:00`,
          endsAt: `${d}T23:59`,
          reason: nextReason,
          notifyCitizens: old.notifyCitizens,
        });
      }
      await tx.insert(t.auditEvents).values({
        id: nid("au"),
        municipalityId,
        at: new Date(),
        actor,
        action: "admin.closure.update",
        detail: closureId,
      });
    });
    await regenerateUnitsAfterClosure(municipalityId, [
      { facilityId: old.facilityId, unitId: old.unitId },
    ]);
    const updatedSkip = firstId
      ? (
          await getDb()
            .select()
            .from(t.closures)
            .where(eq(t.closures.id, firstId))
            .limit(1)
        )[0]
      : null;
    return {
      needsConfirm: false as const,
      ...(updatedSkip ?? old),
      cancelledCount: 0,
      peopleCount: impact.peopleCount,
      matchCount: impact.matchCount,
    };
  }

  const citizenMsg = (patch.notifyReason?.trim() || nextReason).trim();
  const notifyCitizens =
    (patch.notifyCitizens ?? old.notifyCitizens) !== false;
  const { formatDayChip } = await import("@pista-aberta/shared");
  const affected =
    mode === "cancel_notify" && patch.confirm
      ? await getDb()
          .select()
          .from(t.bookings)
          .where(inArray(t.bookings.id, impact.bookingIds))
      : [];
  const notices = await Promise.all(
    affected
      .filter(
        (b): b is typeof b & { userId: string } => b.userId !== null,
      )
      .map(async (b) => {
      const fac = await getFacility(b.facilityId);
      const units = await listUnits(b.facilityId);
      const unitName = units.find((u) => u.id === b.unitId)?.name;
      const alternatives = await closureAlternativesForBooking({
        municipalityId,
        facilityId: b.facilityId,
        unitId: b.unitId,
        date: b.date,
        start: b.start,
        slotId: b.slotId,
      });
      return {
        bookingId: b.id,
        notice: {
          id: nid("n-cl"),
          municipalityId,
          userId: b.userId,
          noticeType: "closure" as const,
          notifyType: "cancelacion" as const,
          title: "Peche de instalación",
          body: `A túa reserva do ${formatDayChip(b.date, "gl")} · ${b.start}–${b.end} foi cancelada: ${citizenMsg}`,
          email: {
            kind: "facility_closure" as const,
            data: {
              sport: fac?.name ?? "Deporte",
              facilityName: fac?.name ?? "Instalación",
              facilityId: b.facilityId,
              facilityAddress: fac?.address,
              unitName,
              dayLabel: formatDayChip(b.date, "gl"),
              timeLabel: `${b.start}–${b.end}`,
              date: b.date,
              start: b.start,
              end: b.end,
              bookingId: b.id,
              icsSequence: b.icsSequence ?? 0,
              reason: citizenMsg,
              alternatives,
            },
          },
        },
      };
      }),
  );
  const operationKey = `closure-update:${closureId}:${nid("op")}`;
  const cancelled = await getDb().transaction(async (tx) => {
    await tx
      .update(t.closures)
      .set({
        startsAt: bounds.startsAt,
        endsAt: bounds.endsAt,
        reason: nextReason,
        notifyCitizens,
      })
      .where(eq(t.closures.id, closureId));
    let count = 0;
    for (const item of notices) {
      const changed = await tx
        .update(t.bookings)
        .set({ status: "cancelled", cancelReason: citizenMsg })
        .where(
          and(
            eq(t.bookings.id, item.bookingId),
            inArray(t.bookings.status, ["confirmed", "pending"]),
          ),
        )
        .returning();
      if (changed.length === 0) continue;
      count += 1;
      if (notifyCitizens) {
        await enqueueUserNotice(
          tx,
          `${operationKey}:booking:${item.bookingId}`,
          municipalityId,
          { operationKey, notice: item.notice },
        );
      }
    }
    await tx.insert(t.auditEvents).values({
      id: nid("au"),
      municipalityId,
      at: new Date(),
      actor,
      action: "admin.closure.update",
      detail: closureId,
    });
    return count;
  });
  await enrichClosureOutboxAlternatives(operationKey);
  await drainNotificationOutboxSafely(operationKey);

  /* Rexenerar rango vello e novo (reabre o vello e pecha o novo). */
  await regenerateUnitsAfterClosure(municipalityId, [
    { facilityId: old.facilityId, unitId: old.unitId },
  ]);

  const updated = await getDb()
    .select()
    .from(t.closures)
    .where(eq(t.closures.id, closureId))
    .limit(1);
  return {
    needsConfirm: false as const,
    ...updated[0]!,
    cancelledCount: cancelled,
    peopleCount: impact.peopleCount,
    matchCount: impact.matchCount,
  };
}

/* ——— Solicitudes ——— */

/** facilityId + unitId obrigatorios (sen defaults do pavillón de Exemplo). */
function requireFacilityUnit(p: Record<string, unknown>): {
  facilityId: string;
  unitId: string;
} {
  const facilityId =
    typeof p.facilityId === "string" ? p.facilityId.trim() : "";
  const unitId = typeof p.unitId === "string" ? p.unitId.trim() : "";
  if (!facilityId) throw new Error("facility_required");
  if (!unitId) throw new Error("unit_required");
  return { facilityId, unitId };
}

async function notifyMunicipalityAdmins(
  municipalityId: string,
  notice: { type: string; title: string; body: string },
) {
  const admins = await getDb()
    .select({ id: t.users.id })
    .from(t.users)
    .where(
      and(
        eq(t.users.municipalityId, municipalityId),
        eq(t.users.role, "admin"),
        eq(t.users.active, true),
      ),
    );
  if (admins.length === 0) {
    await getDb().insert(t.notices).values({
      id: nid("n-req"),
      municipalityId,
      userId: null,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      read: false,
    });
    return;
  }
  for (const a of admins) {
    await getDb().insert(t.notices).values({
      id: nid("n-req"),
      municipalityId,
      userId: a.id,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      read: false,
    });
  }
}

export async function createClubRequest(input: {
  municipalityId: string;
  clubId: string;
  type: "season" | "match" | "match_change";
  payload: Record<string, unknown>;
  note?: string;
  userId: string;
  userName: string;
}) {
  const { facilityId, unitId } = requireFacilityUnit(input.payload);
  const { assertFacilityUnitInMuni } = await import("./tenancy-assert.js");
  await assertFacilityUnitInMuni(input.municipalityId, facilityId, unitId);
  const payload = { ...input.payload, facilityId, unitId };
  const id = nid("req");
  await getDb().insert(t.clubRequests).values({
    id,
    municipalityId: input.municipalityId,
    clubId: input.clubId,
    type: input.type,
    status: "pending",
    payload,
    note: input.note ?? null,
    createdByUserId: input.userId,
    createdByName: input.userName,
  });
  const typeLabel =
    input.type === "season"
      ? "tempada"
      : input.type === "match_change"
        ? "cambio de partido"
        : "partido";
  await notifyMunicipalityAdmins(input.municipalityId, {
    type: "info",
    title: `Nova solicitude de ${typeLabel}: ${input.userName}`,
    body: input.note ?? JSON.stringify(payload),
  });
  await audit(
    input.municipalityId,
    input.userName,
    `club.${input.type}_request`,
    id,
  );
  return { id, status: "pending" as const };
}

/** REVISION-18 T3: pedir cambio en todos agás «Cambio pedido» (tamén choque). */
const CHANGEABLE_MATCH_STATUSES = new Set([
  "scheduled",
  "moved",
  "resolved",
  "swapped",
  "conflict",
  "proposed",
]);

export async function createMatchChangeRequest(input: {
  municipalityId: string;
  clubId: string;
  matchId: string;
  userId: string;
  userName: string;
  note?: string;
  date?: string;
  start?: string;
  end?: string;
  unitId?: string;
  facilityId?: string;
}) {
  const rows = await getDb()
    .select()
    .from(t.matches)
    .where(
      and(
        eq(t.matches.id, input.matchId),
        eq(t.matches.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  const match = rows[0];
  if (!match || match.clubId !== input.clubId) throw new Error("not_found");
  if (match.status === "change_requested") {
    throw new Error("not_changeable");
  }
  if (!CHANGEABLE_MATCH_STATUSES.has(match.status)) {
    throw new Error("not_changeable");
  }

  await getDb()
    .update(t.matches)
    .set({ status: "change_requested" })
    .where(eq(t.matches.id, match.id));

  const home = await getDb()
    .select()
    .from(t.teams)
    .where(eq(t.teams.id, match.homeTeamId))
    .limit(1);
  const away = await getDb()
    .select()
    .from(t.teams)
    .where(eq(t.teams.id, match.awayTeamId))
    .limit(1);
  const nextDate = input.date ?? match.date;
  const nextStart = input.start ?? match.start;
  const nextEnd = input.end ?? match.end;
  const nextUnit = input.unitId ?? match.unitId;
  const reason = input.note?.trim() || "";
  const summary = [
    `${input.userName} pide mover ${home[0]?.name ?? "partido"} a ${nextDate}, ${nextStart}`,
    reason ? `motivo: ${reason}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return createClubRequest({
    municipalityId: input.municipalityId,
    clubId: input.clubId,
    type: "match_change",
    payload: {
      matchId: input.matchId,
      date: nextDate,
      start: nextStart,
      end: nextEnd,
      unitId: nextUnit,
      facilityId: input.facilityId ?? match.facilityId,
      homeTeam: home[0]?.name ?? "",
      awayTeam: away[0]?.name ?? "",
      fromDate: match.date,
      fromStart: match.start,
    },
    note: summary,
    userId: input.userId,
    userName: input.userName,
  });
}

/**
 * REVISION-49 Z1 — aviso + correo aos clubs do partido (local e visitante)
 * co horario novo e .ics actualizado.
 */
export async function notifyMatchMovedToClubs(opts: {
  municipalityId: string;
  matchId: string;
  date: string;
  start: string;
  end: string;
  unitId: string;
  facilityId: string;
  homeTeamId: string;
  awayTeamId: string;
  clubId: string;
  /** REVISION-50 X3 — horario anterior no correo. */
  fromDate?: string;
  fromStart?: string;
}): Promise<{ clubNames: string[] }> {
  const { formatDayChip } = await import("@pista-aberta/shared");
  const { sendUserNotice } = await import("../notify/send-notice.js");

  const home = (
    await getDb()
      .select()
      .from(t.teams)
      .where(eq(t.teams.id, opts.homeTeamId))
      .limit(1)
  )[0];
  const away = (
    await getDb()
      .select()
      .from(t.teams)
      .where(eq(t.teams.id, opts.awayTeamId))
      .limit(1)
  )[0];
  const facility = await getFacility(opts.facilityId);
  const units = await listUnits(opts.facilityId);
  const unit = units.find((u) => u.id === opts.unitId);
  const rawCourt = unit?.name ?? "pista";
  const courtName =
    rawCourt.charAt(0).toLowerCase() + rawCourt.slice(1);
  const dayLabel = formatDayChip(opts.date, "gl");
  const homeTeam = home?.name ?? opts.homeTeamId;
  const awayTeam = away?.name ?? opts.awayTeamId;
  const beforeLabel =
    opts.fromDate && opts.fromStart
      ? `Antes: ${formatDayChip(opts.fromDate, "gl")} ás ${opts.fromStart}`
      : undefined;
  const body = `O voso partido ${homeTeam} – ${awayTeam} pasa ao ${dayLabel} ás ${opts.start}, ${courtName}`;

  const clubIds = new Set<string>([opts.clubId]);
  if (home?.clubId) clubIds.add(home.clubId);
  if (away?.clubId) clubIds.add(away.clubId);

  const clubs = await getDb()
    .select()
    .from(t.clubs)
    .where(eq(t.clubs.municipalityId, opts.municipalityId));
  const clubNameOf = (id: string) =>
    clubs.find((c) => c.id === id)?.name ?? "Club";

  const recipientIds = new Set<string>();
  const notifiedClubIds = new Set<string>();
  for (const clubId of clubIds) {
    const managers = await listClubManagerUserIds(opts.municipalityId, clubId);
    if (managers.length) notifiedClubIds.add(clubId);
    for (const uid of managers) recipientIds.add(uid);
  }

  let i = 0;
  for (const userId of recipientIds) {
    const user = (
      await getDb().select().from(t.users).where(eq(t.users.id, userId)).limit(1)
    )[0];
    const clubId = user?.clubId && clubIds.has(user.clubId) ? user.clubId : opts.clubId;
    await sendUserNotice({
      id: nid(`n-mm-${i++}`),
      municipalityId: opts.municipalityId,
      userId,
      noticeType: "change",
      notifyType: "partido_club",
      title: "Partido movido",
      body: beforeLabel ? `${body}. ${beforeLabel}` : body,
      payload: {
        kind: "match_moved",
        matchId: opts.matchId,
        date: opts.date,
        start: opts.start,
        end: opts.end,
        unitId: opts.unitId,
      },
      email: {
        kind: "match_moved",
        data: {
          clubName: clubNameOf(clubId),
          clubId,
          homeTeam,
          awayTeam,
          dayLabel,
          start: opts.start,
          end: opts.end,
          date: opts.date,
          courtName,
          facilityName: facility?.name,
          matchId: opts.matchId,
          icsSequence: 1,
          beforeLabel,
        },
      },
    });
  }
  return {
    clubNames: [...notifiedClubIds].map((id) => clubNameOf(id)),
  };
}

export async function moveMatch(
  municipalityId: string,
  matchId: string,
  patch: {
    date: string;
    start: string;
    end: string;
    unitId: string;
    facilityId: string;
  },
  actor: string,
) {
  const rows = await getDb()
    .select()
    .from(t.matches)
    .where(
      and(
        eq(t.matches.id, matchId),
        eq(t.matches.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const match = rows[0];
  if (!match) throw new Error("not_found");

  /* REVISION-49 Z3 — mesma data/hora/pista → sen cambio de estado. */
  if (
    match.date === patch.date &&
    match.start === patch.start &&
    match.end === patch.end &&
    match.unitId === patch.unitId &&
    match.facilityId === patch.facilityId
  ) {
    throw new Error("no_change");
  }

  const { assertFacilityUnitInMuni } = await import("./tenancy-assert.js");
  await assertFacilityUnitInMuni(
    municipalityId,
    patch.facilityId,
    patch.unitId,
  );

  /* REVISION-47 W1 */
  await assertMatchSlotTiming({
    municipalityId,
    unitId: patch.unitId,
    date: patch.date,
    start: patch.start,
    end: patch.end,
  });

  const conflicts = await detectClubRequestConflicts(municipalityId, "match", {
    date: patch.date,
    start: patch.start,
    end: patch.end,
    unitId: patch.unitId,
    facilityId: patch.facilityId,
    matchId,
  });
  if (conflicts.length > 0) {
    const err = new Error("conflict");
    (err as Error & { conflicts: typeof conflicts }).conflicts = conflicts;
    throw err;
  }

  const oldUnitId = match.unitId;
  await getDb()
    .update(t.matches)
    .set({
      date: patch.date,
      start: patch.start,
      end: patch.end,
      unitId: patch.unitId,
      facilityId: patch.facilityId,
      status: "moved",
      conflictWith: [],
    })
    .where(eq(t.matches.id, matchId));

  const notified = await notifyMatchMovedToClubs({
    municipalityId,
    matchId,
    date: patch.date,
    start: patch.start,
    end: patch.end,
    unitId: patch.unitId,
    facilityId: patch.facilityId,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    clubId: match.clubId,
    fromDate: match.date,
    fromStart: match.start,
  });

  /* REVISION-50 A2: rexenerar franxas unidade vella, nova e incompatibles. */
  const regenUnits = new Set<string>([oldUnitId, patch.unitId]);
  for (const u of await unitConflictSet(oldUnitId)) regenUnits.add(u);
  for (const u of await unitConflictSet(patch.unitId)) regenUnits.add(u);
  for (const uid of regenUnits) {
    await regenerateSlotsForUnitAhead(municipalityId, uid).catch((err) => {
      console.warn("[slots-ahead] regenerate after move failed", uid, err);
    });
  }

  await audit(municipalityId, actor, "admin.match.move", matchId);
  return {
    id: matchId,
    status: "moved" as const,
    notifiedClubNames: notified.clubNames,
  };
}

export async function listClubRequests(
  municipalityId: string,
  estado?: string,
) {
  const rows = await getDb()
    .select()
    .from(t.clubRequests)
    .where(
      estado
        ? and(
            eq(t.clubRequests.municipalityId, municipalityId),
            eq(t.clubRequests.status, estado),
          )
        : eq(t.clubRequests.municipalityId, municipalityId),
    );
  const clubs = await getDb()
    .select()
    .from(t.clubs)
    .where(eq(t.clubs.municipalityId, municipalityId));
  return rows
    .map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      /* REVISION-39 L9: sen campos internos (_statusBeforeCounter). */
      payload: publicClubPayload(r.payload as Record<string, unknown>),
      note: r.note,
      rejectReason: r.rejectReason,
      clubId: r.clubId,
      clubName: clubs.find((c) => c.id === r.clubId)?.name ?? r.clubId,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** REVISION-39 L9 — quita chaves internas do payload na resposta. */
export function publicClubPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k.startsWith("_")) continue;
    out[k] = v;
  }
  return out;
}

function snapshotOriginalProposal(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const keys = [
    "facilityId",
    "unitId",
    "weekday",
    "date",
    "start",
    "end",
    "homeTeam",
    "awayTeam",
    "matchId",
    "createdResourceId",
  ] as const;
  const snap: Record<string, unknown> = {};
  for (const k of keys) {
    if (payload[k] !== undefined) snap[k] = payload[k];
  }
  return snap;
}

/** REVISION-39 L2 — marca lidos (ou borra) avisos club_counter previos da solicitude. */
async function dismissPriorCounterNotices(
  municipalityId: string,
  requestId: string,
): Promise<void> {
  const rows = await getDb()
    .select()
    .from(t.notices)
    .where(eq(t.notices.municipalityId, municipalityId));
  const stale = rows.filter((n) => {
    const p = n.payload as Record<string, unknown> | null;
    return p?.kind === "club_counter" && p?.requestId === requestId;
  });
  for (const n of stale) {
    if (n.userId) {
      await getDb()
        .insert(t.noticeReads)
        .values({ noticeId: n.id, userId: n.userId, readAt: new Date() })
        .onConflictDoNothing();
    }
    await getDb().delete(t.notices).where(eq(t.notices.id, n.id));
  }
}

async function listClubManagerUserIds(
  municipalityId: string,
  clubId: string,
): Promise<string[]> {
  const rows = await getDb()
    .select({ id: t.users.id })
    .from(t.users)
    .where(
      and(
        eq(t.users.municipalityId, municipalityId),
        eq(t.users.role, "club_manager"),
        eq(t.users.clubId, clubId),
        eq(t.users.active, true),
      ),
    );
  return [...new Set(rows.map((r) => r.id))];
}

function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
}

/**
 * REVISION-47 W1 / REVISION-48 Y1 — validar franxa ao mover/aprobar: end > start,
 * dentro do horario de **apertura** da unidade (partidos/tempadas de club;
 * non a ventá curta de reservas públicas) e (se hai data) non no pasado.
 * Erros: `invalid_time` | `outside_hours` | `in_past`.
 */
export async function assertMatchSlotTiming(input: {
  municipalityId: string;
  unitId: string;
  start: string;
  end: string;
  /** YYYY-MM-DD — activa comprobación `in_past` e resolve o weekday. */
  date?: string;
  /** Para franxas de tempada sen data concreta. */
  weekday?: number;
}): Promise<void> {
  const startMin = timeToMinutes(String(input.start ?? ""));
  const endMin = timeToMinutes(String(input.end ?? ""));
  if (
    !Number.isFinite(startMin) ||
    !Number.isFinite(endMin) ||
    !(endMin > startMin)
  ) {
    throw new Error("invalid_time");
  }

  const weekday =
    input.date != null
      ? localWeekday(input.date)
      : typeof input.weekday === "number"
        ? input.weekday
        : null;
  if (weekday != null) {
    const hours = await listOpeningHours(input.municipalityId, input.unitId);
    const dayHours = input.date
      ? hoursForDate(hours, input.date, weekday)
      : hours.filter(
          (h) => h.weekday === weekday && !h.validFrom && !h.validTo,
        );
    const fits = dayHours.some(
      (h) =>
        startMin >= timeToMinutes(h.open) && endMin <= timeToMinutes(h.close),
    );
    if (!fits) throw new Error("outside_hours");
  }

  if (input.date && isSlotInPast(input.date, input.start)) {
    throw new Error("in_past");
  }
}

async function unitConflictSet(unitId: string): Promise<Set<string>> {
  const { unitConflictSet: shared } = await import("./unit-conflicts.js");
  return shared(unitId);
}

/** Choques lexibles dunha solicitude pendente (antes de aprobar). */
export async function clubRequestConflicts(
  municipalityId: string,
  requestId: string,
): Promise<Array<{ kind: string; detail: string }>> {
  const rows = await getDb()
    .select()
    .from(t.clubRequests)
    .where(
      and(
        eq(t.clubRequests.id, requestId),
        eq(t.clubRequests.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error("not_found");
  return detectClubRequestConflicts(municipalityId, req.type, req.payload as Record<string, unknown>);
}

/** REVISION-50 A3 — preview de choques para intercambio (salta dous partidos). */
export async function clubRequestConflictsPreview(
  municipalityId: string,
  p: {
    date: string;
    start: string;
    end: string;
    unitId: string;
    facilityId: string;
    matchId?: string;
    alsoSkipMatchId?: string;
  },
): Promise<Array<{ kind: string; detail: string }>> {
  return detectClubRequestConflicts(municipalityId, "match", {
    ...p,
    alsoSkipMatchId: p.alsoSkipMatchId,
  });
}

const DOW_SHORT_GL = ["dom", "lun", "mar", "mér", "xov", "ven", "sáb"];

async function unitDisplayName(unitId: string): Promise<string> {
  const unitRow = await getDb()
    .select()
    .from(t.units)
    .where(eq(t.units.id, unitId))
    .limit(1);
  return unitRow[0]?.name ?? unitId;
}

async function clubDisplayName(clubId: string): Promise<string> {
  const clubRow = await getDb()
    .select()
    .from(t.clubs)
    .where(eq(t.clubs.id, clubId))
    .limit(1);
  return clubRow[0]?.shortName ?? clubRow[0]?.name ?? clubId;
}

/** REVISION-51 B2 — detalle lexible sen ids. */
async function formatSeasonConflictDetail(s: {
  clubId: string;
  weekday: number;
  start: string;
  end: string;
  unitId: string;
}): Promise<string> {
  const club = await clubDisplayName(s.clubId);
  const unit = await unitDisplayName(s.unitId);
  const dow = DOW_SHORT_GL[s.weekday] ?? `día ${s.weekday}`;
  return `Tempada ${club} · ${dow} ${s.start}–${s.end} · ${unit}`;
}

async function formatBookingConflictDetail(b: {
  userDisplayName: string;
  start: string;
  end: string;
  unitId: string;
}): Promise<string> {
  const { shortPublicName } = await import("@pista-aberta/shared");
  const who = shortPublicName(b.userDisplayName || "Veciñanza") || "Veciñanza";
  const unit = await unitDisplayName(b.unitId);
  return `Reserva de ${who} · ${b.start}–${b.end} · ${unit}`;
}

/** REVISION-56 H3 — choque de tempada con reserva (inclúe día). */
async function formatSeasonBookingConflictDetail(b: {
  userDisplayName: string;
  date: string;
  start: string;
  end: string;
  unitId: string;
}): Promise<string> {
  const { shortPublicName, formatDayChip } = await import("@pista-aberta/shared");
  const who = shortPublicName(b.userDisplayName || "Veciñanza") || "Veciñanza";
  const unit = await unitDisplayName(b.unitId);
  const chip = formatDayChip(b.date, "gl");
  return `Reserva de ${who} · ${chip} · ${b.start}-${b.end} · ${unit}`;
}

async function detectClubRequestConflicts(
  municipalityId: string,
  type: string,
  p: Record<string, unknown>,
): Promise<Array<{ kind: string; detail: string }>> {
  const conflicts: Array<{ kind: string; detail: string }> = [];
  if (type === "season") {
    const { unitId } = requireFacilityUnit(p);
    const weekday = Number(p.weekday);
    const start = String(p.start);
    const end = String(p.end);
    const units = await unitConflictSet(unitId);
    const existing = await getDb()
      .select()
      .from(t.seasonSlots)
      .where(
        and(
          eq(t.seasonSlots.municipalityId, municipalityId),
          eq(t.seasonSlots.weekday, weekday),
        ),
      );
    const skipId =
      typeof p.createdResourceId === "string" ? p.createdResourceId : null;
    for (const s of existing) {
      if (skipId && s.id === skipId) continue;
      if (!units.has(s.unitId) && s.unitId !== unitId) {
        const other = await unitConflictSet(s.unitId);
        if (!other.has(unitId)) continue;
      }
      if (timesOverlap(start, end, s.start, s.end)) {
        conflicts.push({
          kind: "season_overlap",
          detail: await formatSeasonConflictDetail(s),
        });
      }
    }
    /* REVISION-56 H3: reservas confirmed/pending das próximas 8 semanas ese weekday. */
    const muni = await getMunicipalityById(municipalityId);
    const tz =
      (muni?.settings as { timezone?: string } | undefined)?.timezone ??
      DEFAULT_TIMEZONE;
    const today = localDateIso(new Date(), tz);
    const seasonDates: string[] = [];
    for (let i = 0; i < 56 && seasonDates.length < 8; i++) {
      const d = addDaysIso(today, i);
      if (localWeekday(d, tz) === weekday) seasonDates.push(d);
    }
    if (seasonDates.length > 0) {
      const bookingRows = await getDb()
        .select()
        .from(t.bookings)
        .where(
          and(
            eq(t.bookings.municipalityId, municipalityId),
            inArray(t.bookings.date, seasonDates),
            inArray(t.bookings.status, ["confirmed", "pending"]),
          ),
        );
      for (const b of bookingRows) {
        if (!units.has(b.unitId)) continue;
        if (!timesOverlap(start, end, b.start, b.end)) continue;
        conflicts.push({
          kind: "booking_overlap",
          detail: await formatSeasonBookingConflictDetail(b),
        });
      }
    }
  } else if (type === "match" || type === "match_change") {
    const { unitId } = requireFacilityUnit(p);
    const date = String(p.date);
    const start = String(p.start);
    const end = String(p.end);
    const units = await unitConflictSet(unitId);
    const existing = await getDb()
      .select()
      .from(t.matches)
      .where(
        and(
          eq(t.matches.municipalityId, municipalityId),
          eq(t.matches.date, date),
          ne(t.matches.status, "cancelled"),
        ),
      );
    const skipId =
      typeof p.createdResourceId === "string" ? p.createdResourceId : null;
    const skipMatchId = typeof p.matchId === "string" ? p.matchId : null;
    const alsoSkip =
      typeof p.alsoSkipMatchId === "string" ? p.alsoSkipMatchId : null;
    for (const m of existing) {
      if (skipId && m.id === skipId) continue;
      if (skipMatchId && m.id === skipMatchId) continue;
      if (alsoSkip && m.id === alsoSkip) continue;
      if (!units.has(m.unitId) && m.unitId !== unitId) {
        const other = await unitConflictSet(m.unitId);
        if (!other.has(unitId)) continue;
      }
      if (timesOverlap(start, end, m.start, m.end)) {
        const home = await getDb()
          .select()
          .from(t.teams)
          .where(eq(t.teams.id, m.homeTeamId))
          .limit(1);
        const unitName = await unitDisplayName(m.unitId);
        const teamName = home[0]?.name ?? m.homeTeamId;
        conflicts.push({
          kind: "match_overlap",
          detail: `Coincide con ${teamName} na ${unitName}`,
        });
      }
    }
    /* REVISION-50 A2: reservas confirmed/pending en unidades incompatibles. */
    const bookingRows = await getDb()
      .select()
      .from(t.bookings)
      .where(
        and(
          eq(t.bookings.municipalityId, municipalityId),
          eq(t.bookings.date, date),
          inArray(t.bookings.status, ["confirmed", "pending", "checked_in"]),
        ),
      );
    for (const b of bookingRows) {
      if (!units.has(b.unitId)) continue;
      if (!timesOverlap(start, end, b.start, b.end)) continue;
      conflicts.push({
        kind: "booking_overlap",
        detail: await formatBookingConflictDetail(b),
      });
    }
    /* Franxa de tempada o mesmo weekday. */
    const weekday = localWeekday(date);
    const seasons = await getDb()
      .select()
      .from(t.seasonSlots)
      .where(
        and(
          eq(t.seasonSlots.municipalityId, municipalityId),
          eq(t.seasonSlots.weekday, weekday),
        ),
      );
    for (const s of seasons) {
      if (!units.has(s.unitId) && s.unitId !== unitId) {
        const other = await unitConflictSet(s.unitId);
        if (!other.has(unitId)) continue;
      }
      if (timesOverlap(start, end, s.start, s.end)) {
        conflicts.push({
          kind: "season_overlap",
          detail: await formatSeasonConflictDetail(s),
        });
      }
    }
  }
  return conflicts;
}

function minutesToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * REVISION-51 B1 — horas libres coa mesma validación que `moveMatch`
 * (partidos + reservas + tempadas en unidades incompatibles).
 */
export async function listFreeHoursForMatch(
  municipalityId: string,
  matchId: string,
  opts?: {
    unitId?: string;
    facilityId?: string;
    limit?: number;
    perDay?: number;
    /** Desprazamento de fin de semana (0 = actual). */
    weekOffset?: number;
  },
): Promise<Array<{ date: string; start: string; end: string }>> {
  const rows = await getDb()
    .select()
    .from(t.matches)
    .where(
      and(
        eq(t.matches.id, matchId),
        eq(t.matches.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const match = rows[0];
  if (!match) throw new Error("not_found");

  const unitId = opts?.unitId?.trim() || match.unitId;
  const facilityId = opts?.facilityId?.trim() || match.facilityId;
  const { assertFacilityUnitInMuni } = await import("./tenancy-assert.js");
  await assertFacilityUnitInMuni(municipalityId, facilityId, unitId);

  const dur = Math.max(
    15,
    timeToMinutes(match.end) - timeToMinutes(match.start),
  );
  const limit = opts?.limit ?? 6;
  const perDay = opts?.perDay ?? 3;

  const weekOffset = opts?.weekOffset ?? 0;
  const pav = await pavilionWeekend(municipalityId, weekOffset);
  let weekend = pav.weekend;
  let weekendEnd = pav.weekendEnd;
  /* Se o partido non está nesa fin de semana, ancorar na súa. */
  if (match.date < weekend || match.date > weekendEnd) {
    const wd = localWeekday(match.date);
    const satOffset = wd === 6 ? 0 : wd === 0 ? -1 : -(wd + 1);
    weekend = addDaysIso(match.date, satOffset);
    weekendEnd = addDaysIso(weekend, 1);
  }
  const days = [weekend, weekendEnd];

  const hourRows = await getDb()
    .select()
    .from(t.openingHours)
    .where(eq(t.openingHours.municipalityId, municipalityId));

  const out: Array<{ date: string; start: string; end: string }> = [];
  for (const date of days) {
    if (out.length >= limit) break;
    const wd = localWeekday(date);
    const base = hourRows.filter(
      (h) =>
        h.unitId === unitId &&
        h.weekday === wd &&
        !h.validFrom &&
        !h.validTo,
    );
    const special = hourRows.filter(
      (h) =>
        h.unitId === unitId &&
        h.weekday === wd &&
        h.validFrom &&
        h.validTo &&
        date >= (h.validFrom as string) &&
        date <= (h.validTo as string),
    );
    const pick = special.length ? special : base;
    /* REVISION-52 X3 — sen horario → lista baleira (non 09:00–14:00 por defecto). */
    if (!pick.length) continue;
    const windows = pick.map((h) => ({ open: h.open, close: h.close }));

    const daySlots: Array<{ date: string; start: string; end: string }> = [];
    for (const win of windows) {
      const open = timeToMinutes(win.open);
      const close = timeToMinutes(win.close);
      const first = open % 30 === 0 ? open : open + (30 - (open % 30));
      for (let start = first; start + dur <= close; start += 30) {
        const end = start + dur;
        const startHm = minutesToHm(start);
        const endHm = minutesToHm(end);
        if (
          date === match.date &&
          startHm === match.start &&
          unitId === match.unitId
        ) {
          continue;
        }
        try {
          await assertMatchSlotTiming({
            municipalityId,
            unitId,
            date,
            start: startHm,
            end: endHm,
          });
        } catch {
          continue;
        }
        const conflicts = await detectClubRequestConflicts(
          municipalityId,
          "match",
          {
            date,
            start: startHm,
            end: endHm,
            unitId,
            facilityId,
            matchId,
          },
        );
        if (conflicts.length) continue;
        daySlots.push({ date, start: startHm, end: endHm });
      }
    }
    const picked: typeof daySlots = [];
    if (daySlots.length <= perDay) {
      picked.push(...daySlots);
    } else {
      for (let i = 0; i < perDay; i++) {
        const idx = Math.round((i * (daySlots.length - 1)) / (perDay - 1));
        const slot = daySlots[idx]!;
        if (!picked.some((p) => p.start === slot.start)) picked.push(slot);
      }
    }
    for (const slot of picked) {
      out.push(slot);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export async function approveClubRequest(
  municipalityId: string,
  requestId: string,
  actor: string,
) {
  const rows = await getDb()
    .select()
    .from(t.clubRequests)
    .where(
      and(
        eq(t.clubRequests.id, requestId),
        eq(t.clubRequests.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error("not_found");
  if (req.status !== "pending") throw new Error("not_pending");

  const p = req.payload as Record<string, unknown>;
  const { facilityId, unitId } = requireFacilityUnit(p);

  /* REVISION-47 W1 — mesma validación ca mover partido. */
  if (req.type === "season") {
    await assertMatchSlotTiming({
      municipalityId,
      unitId,
      start: String(p.start ?? ""),
      end: String(p.end ?? ""),
      weekday: Number(p.weekday),
    });
  } else if (req.type === "match" || req.type === "match_change") {
    await assertMatchSlotTiming({
      municipalityId,
      unitId,
      date: String(p.date ?? ""),
      start: String(p.start ?? ""),
      end: String(p.end ?? ""),
    });
  }

  const conflicts = await detectClubRequestConflicts(municipalityId, req.type, p);
  if (conflicts.length > 0) {
    const err = new Error("conflict");
    (err as Error & { conflicts: typeof conflicts }).conflicts = conflicts;
    throw err;
  }

  let createdResourceId: string | null = null;

  if (req.type === "season") {
    // Evitar duplicado exacto da mesma franxa
    const dup = await getDb()
      .select()
      .from(t.seasonSlots)
      .where(
        and(
          eq(t.seasonSlots.municipalityId, municipalityId),
          eq(t.seasonSlots.clubId, req.clubId),
          eq(t.seasonSlots.unitId, unitId),
          eq(t.seasonSlots.weekday, Number(p.weekday)),
          eq(t.seasonSlots.start, String(p.start)),
          eq(t.seasonSlots.end, String(p.end)),
        ),
      )
      .limit(1);
    if (dup[0]) throw new Error("duplicate");

    createdResourceId = nid("ss");
    /* REVISION-58 K3: ligar á campaña publicada que cobre a instalación hoxe;
     * se non hai, gardar validTo (fin da tempada deportiva xul–xuño). */
    const muniForSeason = await getMunicipalityById(municipalityId);
    const tzSeason =
      (muniForSeason?.settings as { timezone?: string } | undefined)?.timezone ??
      DEFAULT_TIMEZONE;
    const todaySeason = localDateIso(new Date(), tzSeason);
    const { listSeasons } = await import("./seasons.js");
    const campaigns = await listSeasons(municipalityId);
    const covering = campaigns.find((s) => {
      if (!s.published) return false;
      if (!s.facilityIds.includes(facilityId)) return false;
      const from = s.startsAt.slice(0, 10);
      const to = s.endsAt.slice(0, 10);
      return todaySeason >= from && todaySeason <= to;
    });
    let seasonId: string | null = covering?.id ?? null;
    let validTo: string | null = null;
    if (!seasonId) {
      const y = Number(todaySeason.slice(0, 4));
      const m = Number(todaySeason.slice(5, 7));
      validTo = m >= 7 ? `${y + 1}-06-30` : `${y}-06-30`;
    }
    await getDb().insert(t.seasonSlots).values({
      id: createdResourceId,
      municipalityId,
      clubId: req.clubId,
      facilityId,
      unitId,
      weekday: Number(p.weekday),
      start: String(p.start),
      end: String(p.end),
      priority: 1,
      seasonId,
      validTo,
    });
  } else if (req.type === "match") {
    const homeId = nid("team");
    const awayId = nid("team");
    await getDb().insert(t.teams).values([
      {
        id: homeId,
        clubId: req.clubId,
        municipalityId,
        name: String(p.homeTeam ?? "Local"),
        category: "senior",
      },
      {
        id: awayId,
        clubId: req.clubId,
        municipalityId,
        name: String(p.awayTeam ?? "Visitante"),
        category: "senior",
      },
    ]);
    createdResourceId = nid("match");
    await getDb().insert(t.matches).values({
      id: createdResourceId,
      municipalityId,
      facilityId,
      unitId,
      date: String(p.date),
      start: String(p.start),
      end: String(p.end),
      homeTeamId: homeId,
      awayTeamId: awayId,
      clubId: req.clubId,
      status: "scheduled",
      conflictWith: [],
      notes: req.note,
    });
  } else if (req.type === "match_change") {
    const matchId = String(p.matchId ?? "");
    if (!matchId) throw new Error("match_required");
    const prevMatch = (
      await getDb()
        .select()
        .from(t.matches)
        .where(
          and(
            eq(t.matches.id, matchId),
            eq(t.matches.municipalityId, municipalityId),
          ),
        )
        .limit(1)
    )[0];
    await getDb()
      .update(t.matches)
      .set({
        facilityId,
        unitId,
        date: String(p.date),
        start: String(p.start),
        end: String(p.end),
        status: "scheduled",
        conflictWith: [],
      })
      .where(
        and(
          eq(t.matches.id, matchId),
          eq(t.matches.municipalityId, municipalityId),
        ),
      );
    createdResourceId = matchId;
    /* REVISION-49 Z1 — ao aprobar un cambio, avisar aos dous clubs. */
    if (prevMatch) {
      await notifyMatchMovedToClubs({
        municipalityId,
        matchId,
        date: String(p.date),
        start: String(p.start),
        end: String(p.end),
        unitId,
        facilityId,
        homeTeamId: prevMatch.homeTeamId,
        awayTeamId: prevMatch.awayTeamId,
        clubId: prevMatch.clubId,
        fromDate: prevMatch.date,
        fromStart: prevMatch.start,
      });
      /* REVISION-50 A2 */
      const regen = new Set<string>([prevMatch.unitId, unitId]);
      for (const u of await unitConflictSet(prevMatch.unitId)) regen.add(u);
      for (const u of await unitConflictSet(unitId)) regen.add(u);
      for (const uid of regen) {
        await regenerateSlotsForUnitAhead(municipalityId, uid).catch((err) => {
          console.warn("[slots-ahead] regenerate after match_change failed", uid, err);
        });
      }
    }
  }

  /* REVISION-56 H3: tempada tamén rexenera franxas (igual ca partido). */
  if (req.type === "match" || req.type === "season") {
    const regen = new Set<string>([unitId]);
    for (const u of await unitConflictSet(unitId)) regen.add(u);
    for (const uid of regen) {
      await regenerateSlotsForUnitAhead(municipalityId, uid).catch((err) => {
        console.warn("[slots-ahead] regenerate after approve failed", uid, err);
      });
    }
  }

  const nextPayload = {
    ...p,
    facilityId,
    unitId,
    ...(createdResourceId ? { createdResourceId } : {}),
  };

  await getDb()
    .update(t.clubRequests)
    .set({
      status: "approved",
      payload: nextPayload,
      resolvedAt: new Date(),
    })
    .where(eq(t.clubRequests.id, requestId));

  const typeLabel =
    req.type === "season"
      ? "de tempada"
      : req.type === "match_change"
        ? "de cambio de partido"
        : "de partido";
  {
    const { sendUserNotice } = await import("../notify/send-notice.js");
    const club = (
      await getDb().select().from(t.clubs).where(eq(t.clubs.id, req.clubId)).limit(1)
    )[0];
    await sendUserNotice({
      id: nid("n-ap"),
      municipalityId,
      userId: req.createdByUserId,
      noticeType: "info",
      notifyType: req.type === "season" ? "partido_club" : "partido_club",
      title: "Proposta aprobada",
      body: `A túa solicitude ${typeLabel} foi aprobada polo concello.`,
      email:
        req.type === "season"
          ? {
              kind: "season_approved",
              data: {
                clubName: club?.name ?? "Club",
                clubId: req.clubId,
                schedules: [
                  [
                    typeof p.weekday === "number"
                      ? ["dom", "lun", "mar", "mér", "xov", "ven", "sáb"][Number(p.weekday)]
                      : "",
                    String(p.start ?? ""),
                    String(p.end ?? ""),
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .replace(/^(\S+)\s+(\S+)\s+(\S+)$/, "$1 $2–$3"),
                ].filter((s) => s.trim()),
                note: req.note ?? undefined,
              },
            }
          : undefined,
    });
  }
  await audit(municipalityId, actor, "admin.request.approve", requestId);
  return { id: requestId, status: "approved" as const };
}

export async function rejectClubRequest(
  municipalityId: string,
  requestId: string,
  actor: string,
  reason: string,
) {
  const rows = await getDb()
    .select()
    .from(t.clubRequests)
    .where(
      and(
        eq(t.clubRequests.id, requestId),
        eq(t.clubRequests.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error("not_found");
  if (req.status !== "pending") throw new Error("not_pending");
  if (!reason?.trim()) throw new Error("reason_required");

  await getDb()
    .update(t.clubRequests)
    .set({
      status: "rejected",
      rejectReason: reason.trim(),
      resolvedAt: new Date(),
    })
    .where(eq(t.clubRequests.id, requestId));

  {
    const { sendUserNotice } = await import("../notify/send-notice.js");
    const club = (
      await getDb().select().from(t.clubs).where(eq(t.clubs.id, req.clubId)).limit(1)
    )[0];
    await sendUserNotice({
      id: nid("n-rj"),
      municipalityId,
      userId: req.createdByUserId,
      noticeType: "info",
      notifyType: "partido_club",
      title: "Proposta rexeitada",
      body: reason.trim(),
      email:
        req.type === "season"
          ? {
              kind: "season_rejected",
              data: {
                clubName: club?.name ?? "Club",
                clubId: req.clubId,
                reason: reason.trim(),
                schedules: (() => {
                  const p = req.payload as Record<string, unknown>;
                  const wd =
                    typeof p.weekday === "number"
                      ? ["dom", "lun", "mar", "mér", "xov", "ven", "sáb"][Number(p.weekday)]
                      : "";
                  const line = [wd, String(p.start ?? ""), String(p.end ?? "")]
                    .filter(Boolean)
                    .join(" ")
                    .replace(/^(\S+)\s+(\S+)\s+(\S+)$/, "$1 $2–$3");
                  return line.trim() ? [line] : [];
                })(),
                note: req.note ?? undefined,
              },
            }
          : undefined,
    });
  }
  await audit(municipalityId, actor, "admin.request.reject", `${requestId}: ${reason}`);
  return { id: requestId, status: "rejected" as const };
}

const DOW_GL = ["domingo", "luns", "martes", "mércores", "xoves", "venres", "sábado"];

/** REVISION-38 J6 — etiqueta humana (día/hora · nome pista), sen ids. */
async function formatClubProposalLabel(
  type: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const start = String(payload.start ?? "");
  const end = String(payload.end ?? "");
  const time = start && end ? `${start}–${end}` : start || end;
  let dayPart = "";
  if (type === "season" && typeof payload.weekday === "number") {
    dayPart = DOW_GL[Number(payload.weekday)] ?? `día ${payload.weekday}`;
  } else if (typeof payload.date === "string" && payload.date) {
    try {
      const { formatDayChip } = await import("@pista-aberta/shared");
      dayPart = formatDayChip(payload.date, "gl");
    } catch {
      dayPart = String(payload.date);
    }
  }
  let pista = "";
  const facilityId =
    typeof payload.facilityId === "string" ? payload.facilityId : "";
  const unitId = typeof payload.unitId === "string" ? payload.unitId : "";
  if (facilityId) {
    const fac = await getFacility(facilityId);
    const units = await listUnits(facilityId);
    const unit = units.find((u) => u.id === unitId);
    if (fac && unit) pista = `${fac.name}, ${unit.name}`;
    else if (fac) pista = fac.name;
    else if (unit) pista = unit.name;
  }
  return [dayPart, time, pista].filter(Boolean).join(", ");
}

export type ClubCounterExpect = {
  counterVersion?: number;
  start?: string;
  end?: string;
  date?: string;
  weekday?: number;
};

function assertCounterExpect(
  payload: Record<string, unknown>,
  expected?: ClubCounterExpect,
): void {
  if (!expected) return;
  if (
    expected.counterVersion != null &&
    Number(payload.counterVersion ?? 0) !== Number(expected.counterVersion)
  ) {
    throw new Error("stale_counter");
  }
  if (
    expected.start != null &&
    String(payload.start ?? "") !== String(expected.start)
  ) {
    throw new Error("stale_counter");
  }
  if (
    expected.end != null &&
    String(payload.end ?? "") !== String(expected.end)
  ) {
    throw new Error("stale_counter");
  }
  if (
    expected.date != null &&
    String(payload.date ?? "") !== String(expected.date)
  ) {
    throw new Error("stale_counter");
  }
  if (
    expected.weekday != null &&
    Number(payload.weekday ?? NaN) !== Number(expected.weekday)
  ) {
    throw new Error("stale_counter");
  }
}

/**
 * REVISION-38 J4–J6 — reprogramar = contraproposta (`counter_proposed`).
 * REVISION-39 L1/L2/L3 — orixinal, versión, avisos a todas as xestoras.
 * Non toca matches/season_slots ata que o club acepte (J5).
 */
export async function moveClubRequest(
  municipalityId: string,
  requestId: string,
  actor: string,
  patch: {
    facilityId?: string;
    unitId?: string;
    weekday?: number;
    date?: string;
    start?: string;
    end?: string;
  },
) {
  const rows = await getDb()
    .select()
    .from(t.clubRequests)
    .where(
      and(
        eq(t.clubRequests.id, requestId),
        eq(t.clubRequests.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error("not_found");
  if (
    req.status !== "pending" &&
    req.status !== "approved" &&
    req.status !== "counter_proposed"
  ) {
    throw new Error("not_movable");
  }

  const prev = req.payload as Record<string, unknown>;
  const next: Record<string, unknown> = { ...prev };
  /* L1: gardar proposta orixinal do club só a primeira vez. */
  if (!prev.original || typeof prev.original !== "object") {
    next.original = snapshotOriginalProposal(prev);
  }
  if (patch.facilityId !== undefined) next.facilityId = patch.facilityId;
  if (patch.unitId !== undefined) next.unitId = patch.unitId;
  if (patch.weekday !== undefined) next.weekday = patch.weekday;
  if (patch.date !== undefined) next.date = patch.date;
  if (patch.start !== undefined) next.start = patch.start;
  if (patch.end !== undefined) next.end = patch.end;

  const { facilityId, unitId } = requireFacilityUnit(next);
  next.facilityId = facilityId;
  next.unitId = unitId;
  next._statusBeforeCounter =
    req.status === "counter_proposed"
      ? (prev._statusBeforeCounter ?? "pending")
      : req.status;
  next.counterVersion = Number(prev.counterVersion ?? 0) + 1;

  if (req.type === "season") {
    if (next.weekday == null || next.start == null || next.end == null) {
      throw new Error("slot_required");
    }
    /* REVISION-47 W1 */
    await assertMatchSlotTiming({
      municipalityId,
      unitId,
      start: String(next.start),
      end: String(next.end),
      weekday: Number(next.weekday),
    });
  } else if (req.type === "match" || req.type === "match_change") {
    if (next.date == null || next.start == null || next.end == null) {
      throw new Error("slot_required");
    }
    /* REVISION-47 W1 */
    await assertMatchSlotTiming({
      municipalityId,
      unitId,
      date: String(next.date),
      start: String(next.start),
      end: String(next.end),
    });
  }

  const conflicts = await detectClubRequestConflicts(
    municipalityId,
    req.type,
    next,
  );
  if (conflicts.length > 0) {
    const err = new Error("conflict");
    (err as Error & { conflicts: typeof conflicts }).conflicts = conflicts;
    throw err;
  }

  /* L2: avisos vellos desa solicitude → lidos/borrados. */
  await dismissPriorCounterNotices(municipalityId, requestId);

  /* J5: non escribir matches/season_slots aquí — só no acceptClubCounter. */
  await getDb()
    .update(t.clubRequests)
    .set({ status: "counter_proposed", payload: next, resolvedAt: null })
    .where(eq(t.clubRequests.id, requestId));

  const whenLabel = await formatClubProposalLabel(req.type, next);
  const original =
    next.original && typeof next.original === "object"
      ? (next.original as Record<string, unknown>)
      : snapshotOriginalProposal(prev);
  const askedLabel = await formatClubProposalLabel(req.type, original);
  const body = `Pediu: ${askedLabel} · Propuxemos: ${whenLabel}`;
  const club = (
    await getDb().select().from(t.clubs).where(eq(t.clubs.id, req.clubId)).limit(1)
  )[0];
  const { sendUserNotice } = await import("../notify/send-notice.js");
  /* L3: avisar a todas as xestoras do club. */
  let recipients = await listClubManagerUserIds(municipalityId, req.clubId);
  if (!recipients.includes(req.createdByUserId)) {
    recipients = [...recipients, req.createdByUserId];
  }
  for (const userId of recipients) {
    await sendUserNotice({
      id: nid("n-mv"),
      municipalityId,
      userId,
      noticeType: "info",
      notifyType: "partido_club",
      title: "O concello propón outro horario",
      body,
      payload: {
        kind: "club_counter",
        requestId,
        whenLabel,
        askedLabel,
        clubId: req.clubId,
        counterVersion: next.counterVersion,
        start: next.start,
        end: next.end,
        date: next.date,
        weekday: next.weekday,
        requestStatus: "counter_proposed",
      },
      email: {
        kind: "club_counter",
        data: {
          clubName: club?.name ?? "Club",
          clubId: req.clubId,
          whenLabel,
          askedLabel,
        },
      },
    });
  }
  await audit(municipalityId, actor, "admin.request.move", requestId);
  return {
    id: requestId,
    status: "counter_proposed" as const,
    payload: publicClubPayload(next),
  };
}

async function assertClubCanRespond(
  municipalityId: string,
  clubId: string,
  actorUserId: string,
): Promise<void> {
  const { clubAccountOwnsClub } = await import("./club-accounts.js");
  const { mapUser } = await import("../db/mappers.js");
  const userRows = await getDb()
    .select()
    .from(t.users)
    .where(eq(t.users.id, actorUserId))
    .limit(1);
  const row = userRows[0];
  if (!row) throw new Error("forbidden");
  if (!clubAccountOwnsClub(mapUser(row), clubId, municipalityId)) {
    throw new Error("forbidden");
  }
}

/** REVISION-38 J4 / REVISION-39 L2 L3 L8 — o club acepta a contraproposta. */
export async function acceptClubCounter(
  municipalityId: string,
  requestId: string,
  actorUserId: string,
  expected?: ClubCounterExpect,
) {
  const rows = await getDb()
    .select()
    .from(t.clubRequests)
    .where(
      and(
        eq(t.clubRequests.id, requestId),
        eq(t.clubRequests.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error("not_found");
  if (req.status !== "counter_proposed") throw new Error("not_counter");
  /* L3: calquera xestora do club. */
  await assertClubCanRespond(municipalityId, req.clubId, actorUserId);

  const p = { ...(req.payload as Record<string, unknown>) };
  assertCounterExpect(p, expected);

  const before = String(p._statusBeforeCounter ?? "pending");
  const { facilityId, unitId } = requireFacilityUnit(p);

  /* L8: mirar choques antes de cambiar o estado; 409 e a proposta segue viva. */
  if (before !== "approved") {
    const conflicts = await detectClubRequestConflicts(
      municipalityId,
      req.type,
      p,
    );
    if (conflicts.length > 0) {
      const err = new Error("conflict");
      (err as Error & { conflicts: typeof conflicts }).conflicts = conflicts;
      throw err;
    }
  } else {
    const conflicts = await detectClubRequestConflicts(
      municipalityId,
      req.type === "match_change" ? "match" : req.type,
      p,
    );
    if (conflicts.length > 0) {
      const err = new Error("conflict");
      (err as Error & { conflicts: typeof conflicts }).conflicts = conflicts;
      throw err;
    }
  }

  if (before === "approved" || (req.type === "match_change" && before === "approved")) {
    const resourceId =
      typeof p.createdResourceId === "string" ? p.createdResourceId : null;
    const matchIdFromChange =
      req.type === "match_change" && typeof p.matchId === "string"
        ? p.matchId
        : null;
    const matchId = matchIdFromChange ?? resourceId;
    if (req.type === "season") {
      if (!resourceId) throw new Error("resource_missing");
      await getDb()
        .update(t.seasonSlots)
        .set({
          facilityId,
          unitId,
          weekday: Number(p.weekday),
          start: String(p.start),
          end: String(p.end),
        })
        .where(
          and(
            eq(t.seasonSlots.id, resourceId),
            eq(t.seasonSlots.municipalityId, municipalityId),
          ),
        );
    } else if (matchId) {
      await getDb()
        .update(t.matches)
        .set({
          facilityId,
          unitId,
          date: String(p.date),
          start: String(p.start),
          end: String(p.end),
          status: "scheduled",
        })
        .where(
          and(
            eq(t.matches.id, matchId),
            eq(t.matches.municipalityId, municipalityId),
          ),
        );
      p.createdResourceId = matchId;
    } else {
      throw new Error("resource_missing");
    }
    await dismissPriorCounterNotices(municipalityId, requestId);
    await getDb()
      .update(t.clubRequests)
      .set({ status: "approved", resolvedAt: new Date(), payload: p })
      .where(eq(t.clubRequests.id, requestId));
    await audit(municipalityId, actorUserId, "club.counter.accept", requestId);
    return { id: requestId, status: "approved" as const };
  }

  /* Pendente: aproveitar approve sen perder a contraproposta se hai choque (xa mirado). */
  await getDb()
    .update(t.clubRequests)
    .set({ status: "pending", payload: p })
    .where(eq(t.clubRequests.id, requestId));
  try {
    const approved = await approveClubRequest(
      municipalityId,
      requestId,
      actorUserId,
    );
    await dismissPriorCounterNotices(municipalityId, requestId);
    await audit(municipalityId, actorUserId, "club.counter.accept", requestId);
    return approved;
  } catch (e) {
    /* Se approve falla despois do check, restaurar counter_proposed. */
    await getDb()
      .update(t.clubRequests)
      .set({ status: "counter_proposed", payload: p, resolvedAt: null })
      .where(eq(t.clubRequests.id, requestId));
    throw e;
  }
}

/** REVISION-38 J4 / REVISION-39 L1 L2 L3 — o club rexeita → restaura orixinal. */
export async function rejectClubCounter(
  municipalityId: string,
  requestId: string,
  actorUserId: string,
  expected?: ClubCounterExpect,
) {
  const rows = await getDb()
    .select()
    .from(t.clubRequests)
    .where(
      and(
        eq(t.clubRequests.id, requestId),
        eq(t.clubRequests.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error("not_found");
  if (req.status !== "counter_proposed") throw new Error("not_counter");
  await assertClubCanRespond(municipalityId, req.clubId, actorUserId);

  const prev = req.payload as Record<string, unknown>;
  assertCounterExpect(prev, expected);

  const original =
    prev.original && typeof prev.original === "object"
      ? (prev.original as Record<string, unknown>)
      : snapshotOriginalProposal(prev);
  const restored: Record<string, unknown> = {
    ...prev,
    ...original,
  };
  const beforeStatus = String(prev._statusBeforeCounter ?? "pending");
  const nextStatus = beforeStatus === "approved" ? "approved" : "pending";
  delete restored.original;
  delete restored.counterVersion;
  delete restored._statusBeforeCounter;

  await getDb()
    .update(t.clubRequests)
    .set({
      status: nextStatus,
      payload: restored,
      resolvedAt: nextStatus === "approved" ? new Date() : null,
    })
    .where(eq(t.clubRequests.id, requestId));

  await dismissPriorCounterNotices(municipalityId, requestId);

  const whenLabel = await formatClubProposalLabel(req.type, prev);
  await notifyMunicipalityAdmins(municipalityId, {
    type: "info",
    title: "O club rexeitou a proposta",
    body:
      nextStatus === "approved"
        ? `O club rexeitou a reprogramación (${whenLabel}). Mantense a aprobación orixinal.`
        : `O club rexeitou a reprogramación (${whenLabel}). A solicitude volve a pendente.`,
  });
  await audit(municipalityId, actorUserId, "club.counter.reject", requestId);
  return {
    id: requestId,
    status: nextStatus as "pending" | "approved",
    payload: publicClubPayload(restored),
  };
}

export async function pendingRequestsCount(municipalityId: string) {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(t.clubRequests)
    .where(
      and(
        eq(t.clubRequests.municipalityId, municipalityId),
        eq(t.clubRequests.status, "pending"),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function checkInByShortCode(
  shortCode: string,
  municipalityId: string,
  now: Date = new Date(),
) {
  const { checkInByQr } = await import("./db.js");
  let code = shortCode.trim().toUpperCase().replace(/\s+/g, "");
  if (code && !code.startsWith("PA-") && /^[A-Z0-9]{4,8}$/.test(code)) {
    code = `PA-${code}`;
  }
  /* REVISION-56 H4: buscar por short_code en SQL (non cargar todas as reservas). */
  const bare = code.replace(/^PA-/, "");
  const codeVariants = [...new Set([code, bare, `PA-${bare}`].filter(Boolean))];
  const rows = await getDb()
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, municipalityId),
        inArray(t.bookings.shortCode, codeVariants),
      ),
    )
    .limit(5);
  const b = rows.find((r) => {
    const sc = r.shortCode.toUpperCase();
    return sc === code || sc.replace(/^PA-/, "") === bare;
  });
  if (!b) return { valid: false as const, reason: "reserva_inexistente" };
  return checkInByQr(b.qrPayload, municipalityId, now);
}

/** Busca cidadáns por nome, correo ou identificador (DNI/NIF mock). */
export async function searchCitizens(
  municipalityId: string,
  q: string,
  limit = 12,
) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const rows = await getDb()
    .select()
    .from(t.users)
    .where(
      and(
        eq(t.users.municipalityId, municipalityId),
        eq(t.users.role, "citizen"),
        eq(t.users.active, true),
      ),
    );
  return rows
    .filter((u) => {
      const hay = `${u.displayName} ${u.email ?? ""} ${u.personIdentifier ?? ""}`.toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, limit)
    .map((u) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      personIdentifier: u.personIdentifier,
    }));
}

/* ——— Actividades ——— */

export async function createActivityAdmin(
  municipalityId: string,
  actor: string,
  input: {
    name: string;
    description?: string;
    facilityId: string;
    days: string;
    hours: string;
    places: number;
    ageMin: number;
    ageMax: number;
    method: "first_come" | "lottery";
    deadline: string;
  },
) {
  const fac = await getFacility(input.facilityId);
  if (!fac || fac.municipalityId !== municipalityId) throw new Error("not_found");
  if (input.ageMin > input.ageMax) throw new Error("invalid_age_range");
  const id = nid("act");
  let lotterySecret: string | null = null;
  let lotterySeedHash: string | null = null;
  let lotteryStatus: "open" | "closed" | "drawn" = "open";
  if (input.method === "lottery") {
    lotterySecret = generateLotterySecret();
    lotterySeedHash = hashSecret(lotterySecret);
    lotteryStatus = "open";
  }
  await getDb().insert(t.activities).values({
    id,
    municipalityId,
    facilityId: input.facilityId,
    name: input.name,
    description: (input.description ?? "").trim(),
    days: input.days,
    hours: input.hours,
    places: input.places,
    ageMin: input.ageMin,
    ageMax: input.ageMax,
    method: input.method,
    deadline: input.deadline,
    lotteryStatus,
    lotterySeedHash,
    lotterySecret,
    lotteryResultOrder: null,
  });
  await audit(
    municipalityId,
    actor,
    "admin.activity.create",
    `${input.name} (${id}) · ${input.method}`,
  );
  return getActivity(id);
}

export async function updateActivityAdmin(
  municipalityId: string,
  activityId: string,
  actor: string,
  patch: Partial<{
    name: string;
    description: string;
    facilityId: string;
    days: string;
    hours: string;
    places: number;
    ageMin: number;
    ageMax: number;
    method: "first_come" | "lottery";
    deadline: string;
    lotteryStatus: "open" | "closed";
  }>,
) {
  const act = await getActivity(activityId);
  if (!act || act.municipalityId !== municipalityId) throw new Error("not_found");
  if ((patch as { lotteryStatus?: string }).lotteryStatus === "drawn") {
    throw new Error("invalid_lottery_status");
  }
  if (act.lotteryStatus === "drawn") {
    if (
      patch.lotteryStatus !== undefined ||
      (patch.places !== undefined && patch.places !== act.places) ||
      (patch.method !== undefined && patch.method !== act.method)
    ) {
      throw new Error("lottery_already_drawn");
    }
  }
  const nextMin = patch.ageMin ?? act.ageMin;
  const nextMax = patch.ageMax ?? act.ageMax;
  if (nextMin > nextMax) throw new Error("invalid_age_range");
  if (patch.facilityId !== undefined) {
    const { assertFacilityInMuni } = await import("./tenancy-assert.js");
    await assertFacilityInMuni(municipalityId, patch.facilityId);
  }
  // Non permitir cambiar o segredo unha vez abertas as inscricións (spec §7).
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.facilityId !== undefined) set.facilityId = patch.facilityId;
  if (patch.days !== undefined) set.days = patch.days;
  if (patch.hours !== undefined) set.hours = patch.hours;
  if (patch.places !== undefined) set.places = patch.places;
  if (patch.ageMin !== undefined) set.ageMin = patch.ageMin;
  if (patch.ageMax !== undefined) set.ageMax = patch.ageMax;
  if (patch.method !== undefined && patch.method !== act.method) {
    const existingApps = await getDb()
      .select({ id: t.activityApplications.id })
      .from(t.activityApplications)
      .where(eq(t.activityApplications.activityId, activityId))
      .limit(1);
    if (existingApps.length > 0) {
      throw new Error("has_applications");
    }
    set.method = patch.method;
    if (patch.method === "lottery" && !act.lotterySeedHash) {
      const secret = generateLotterySecret();
      set.lotterySecret = secret;
      set.lotterySeedHash = hashSecret(secret);
    }
  }
  if (patch.deadline !== undefined) set.deadline = patch.deadline;
  if (patch.lotteryStatus !== undefined) set.lotteryStatus = patch.lotteryStatus;
  if (Object.keys(set).length) {
    await getDb().update(t.activities).set(set).where(eq(t.activities.id, activityId));
  }
  await audit(municipalityId, actor, "admin.activity.update", activityId);
  return getActivity(activityId);
}

export async function listActivityAdminDetail(
  municipalityId: string,
  activityId: string,
) {
  const act = await getActivity(activityId);
  if (!act || act.municipalityId !== municipalityId) throw new Error("not_found");
  const apps = await getDb()
    .select()
    .from(t.activityApplications)
    .where(eq(t.activityApplications.activityId, activityId));
  const users = await getDb()
    .select()
    .from(t.users)
    .where(eq(t.users.municipalityId, municipalityId));
  return {
    ...act,
    applications: apps.map((a) => {
      const mapped = mapApplication(a);
      const u = users.find((x) => x.id === a.userId);
      return {
        ...mapped,
        displayName: u?.displayName ?? a.userId,
        email: u?.email ?? null,
      };
    }),
  };
}

export async function runLotteryAdmin(
  municipalityId: string,
  activityId: string,
  actor: string,
) {
  const result = await runLottery(activityId, municipalityId);
  await audit(
    municipalityId,
    actor,
    "admin.lottery.run",
    `${activityId}: ${result.accepted.length} aceptadas`,
  );
  return result;
}

/** Pendentes para a portada «Hoxe». */
export async function adminHomeTodos(municipalityId: string) {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) throw new Error("not_found");
  const today = localDateIso(new Date(), muniTz(muni));

  const pendingReqs = await pendingRequestsCount(municipalityId);
  const pav = await pavilionWeekend(municipalityId);
  const conflicts = pav.conflicts;

  const acts = await listActivities(municipalityId);
  const overdueLotteries = acts.filter(
    (a) =>
      a.method === "lottery" &&
      a.lotteryStatus !== "drawn" &&
      a.deadline < today,
  );

  const closures = await getDb()
    .select()
    .from(t.closures)
    .where(eq(t.closures.municipalityId, municipalityId));
  const activeClosures = closures.filter((c) => {
    const start = c.startsAt.slice(0, 10);
    const end = c.endsAt.slice(0, 10);
    return start <= today && end >= today;
  });

  const { openIncidentsCount } = await import("./incidents.js");
  const openIncidents = await openIncidentsCount(municipalityId);

  const { listPendingBookings } = await import("./db.js");
  const pendingBookings = await listPendingBookings(municipalityId);

  return {
    pendingRequests: pendingReqs,
    pendingBookings: pendingBookings.length,
    pendingBookingRows: pendingBookings.slice(0, 10).map((b) => ({
      id: b.id,
      userDisplayName: b.userDisplayName,
      date: b.date,
      start: b.start,
      end: b.end,
      facilityId: b.facilityId,
    })),
    pavilionConflicts: conflicts,
    openIncidents,
    overdueLotteries: overdueLotteries.map((a) => ({
      id: a.id,
      name: a.name,
      deadline: a.deadline,
    })),
    activeClosures: activeClosures.map((c) => ({
      id: c.id,
      reason: c.reason,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
    })),
  };
}
