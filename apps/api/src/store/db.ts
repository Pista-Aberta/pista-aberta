/**
 * Repositorio de negocio sobre Drizzle (substitúe o store en memoria).
 * API pública async — mesmas formas que a demo UI espera.
 */
import { randomUUID } from "node:crypto";
import { newId } from "../lib/ids.js";
import { and, eq, gte, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import type {
  Activity,
  ActivityApplication,
  Booking,
  Club,
  Facility,
  MatchSlot,
  Municipality,
  SlotSwap,
  Team,
  TimeSlot,
  Unit,
} from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import {
  mapActivity,
  mapApplication,
  mapBooking,
  mapClub,
  mapFacility,
  mapMatch,
  mapMunicipality,
  mapSlot,
  mapSwap,
  mapTeam,
  mapUnit,
} from "../db/mappers.js";
import {
  DEFAULT_ANONYMIZE_AFTER_DAYS,
  DEFAULT_MAX_ACTIVE_BOOKINGS,
  DEFAULT_TIMEZONE,
  QR_CHECKIN_MARGIN_MINUTES,
  addDaysIso,
  isSlotInPast,
  localDateIso,
  slotInstant,
  slotDurationHours,
  weekStartIso,
  weekendSaturdayIso,
} from "./business-rules.js";
import { rulesFromSettings, resolveFacilityRules } from "./rules.js";
import { drawOrder, hashSecret, verifyDraw } from "./lottery.js";
import { lockBookingResources } from "./booking-locks.js";

function muniTimezone(muni: { settings: { timezone?: string } } | null | undefined): string {
  return muni?.settings.timezone ?? DEFAULT_TIMEZONE;
}
import { makeShortCode, signQrPayload, verifyQrPayload } from "./qr.js";

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  return (
    e?.code === "23505" ||
    e?.cause?.code === "23505" ||
    /unique|duplicate key/i.test(e?.message ?? "")
  );
}

const cancelHooks: Array<(slotId: string, municipalityId: string) => void | Promise<void>> =
  [];

export function onBookingCancelled(
  fn: (slotId: string, municipalityId: string) => void | Promise<void>,
) {
  cancelHooks.push(fn);
}

/** Efectos posteriores ao commit dunha cancelación feita por outra transacción. */
export async function notifyBookingCancellationCommitted(booking: {
  id: string;
  slotId: string;
  municipalityId: string;
}): Promise<void> {
  for (const fn of cancelHooks) {
    await fn(booking.slotId, booking.municipalityId);
  }
  const { cancelOpenMatchForBooking } = await import("./open-matches.js");
  await cancelOpenMatchForBooking(
    booking.id,
    "A persoa organizadora pechou a conta.",
  );
}

/** Compat: a demo antiga tiña getStore(); agora devolve null. */
export function getStore(): null {
  return null;
}

/** Sandbox ou sen publicar: oculto na lista pública da portada. */
function isPublicMunicipality(m: Municipality): boolean {
  if (m.settings.deputacionPlatform) return false;
  if (m.settings.sandbox) return false;
  if (m.settings.portalPublished === false) return false;
  return true;
}

/** Lista pública: sen sandbox caducados/ocultos. */
export async function listMunicipalities(): Promise<Municipality[]> {
  const rows = await getDb().select().from(t.municipalities);
  return rows.map(mapMunicipality).filter(isPublicMunicipality);
}

/** Inclúe sandbox (admin / resolución por slug). */
export async function listMunicipalitiesAll(): Promise<Municipality[]> {
  const rows = await getDb().select().from(t.municipalities);
  return rows.map(mapMunicipality);
}

/** Rate limit alta pública (IP ou global demo): máx 5 / 10 min. */
const muniCreateHits: number[] = [];

export function assertMunicipalityCreateRateLimit(): void {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  while (muniCreateHits.length && now - muniCreateHits[0]! > windowMs) {
    muniCreateHits.shift();
  }
  if (muniCreateHits.length >= 5) {
    throw new Error("rate_limited");
  }
  muniCreateHits.push(now);
}

export async function getMunicipalityBySlug(
  slug: string,
): Promise<Municipality | undefined> {
  const rows = await getDb()
    .select()
    .from(t.municipalities)
    .where(eq(t.municipalities.slug, slug))
    .limit(1);
  return rows[0] ? mapMunicipality(rows[0]) : undefined;
}

export async function getMunicipalityById(
  id: string,
): Promise<Municipality | undefined> {
  const rows = await getDb()
    .select()
    .from(t.municipalities)
    .where(eq(t.municipalities.id, id))
    .limit(1);
  return rows[0] ? mapMunicipality(rows[0]) : undefined;
}

export async function createMunicipality(input: {
  name: string;
  slug: string;
  accentColor: string;
  accent?: string;
  theme?: { brand?: string; accent?: string };
  /** false = alta Deputación (borrador). */
  sandbox?: boolean;
  /** REVISION-29 Y14 — limpeza diaria na demo (Europe/Madrid). */
  demoCreatedDay?: string;
  /** REVISION-40 N2 — código INE (MeteoGalicia). */
  ineCode?: string;
}): Promise<Municipality> {
  const existing = await getMunicipalityBySlug(input.slug);
  if (existing) throw new Error("slug_exists");
  const { resolveTheme } = await import("@pista-aberta/shared");
  const theme = resolveTheme({
    accentColor: input.accentColor,
    theme: {
      brand: input.theme?.brand ?? input.accentColor,
      accent: input.theme?.accent ?? input.accent ?? input.accentColor,
    },
  });
  const sandbox = input.sandbox === true;
  const ineCode = String(input.ineCode ?? "").replace(/\D/g, "").slice(0, 5);
  const m: Municipality = {
    id: `muni-${input.slug}`,
    slug: input.slug,
    name: input.name,
    accentColor: theme.brand,
    locales: ["gl", "es"],
    settings: {
      maxHoursPerWeek: 4,
      bookingAntelationDays: 7,
      maxActiveBookings: DEFAULT_MAX_ACTIVE_BOOKINGS,
      anonymizeAfterDays: DEFAULT_ANONYMIZE_AFTER_DAYS,
      cancelMinHours: 2,
      checkInMarginMinutes: QR_CHECKIN_MARGIN_MINUTES,
      noShowReleaseMinutes: 30,
      timezone: DEFAULT_TIMEZONE,
      theme,
      ...(/^\d{5}$/.test(ineCode) ? { ineCode } : {}),
      ...(sandbox
        ? {
            sandbox: true,
            sandboxExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }
        : { portalPublished: false }),
      ...(input.demoCreatedDay ? { demoCreatedDay: input.demoCreatedDay } : {}),
    },
  };
  await getDb().insert(t.municipalities).values({
    id: m.id,
    slug: m.slug,
    name: m.name,
    accentColor: m.accentColor,
    locales: m.locales,
    settings: m.settings,
  });
  return m;
}

export async function listFacilities(municipalityId: string): Promise<Facility[]> {
  const rows = await getDb()
    .select()
    .from(t.facilities)
    .where(
      and(eq(t.facilities.municipalityId, municipalityId), eq(t.facilities.active, true)),
    );
  return rows.map(mapFacility);
}

export async function getFacility(id: string): Promise<Facility | undefined> {
  const rows = await getDb()
    .select()
    .from(t.facilities)
    .where(eq(t.facilities.id, id))
    .limit(1);
  return rows[0] ? mapFacility(rows[0]) : undefined;
}

export async function listUnits(facilityId: string): Promise<Unit[]> {
  const rows = await getDb()
    .select()
    .from(t.units)
    .where(eq(t.units.facilityId, facilityId));
  return rows.map(mapUnit);
}

export async function listSlots(opts: {
  municipalityId: string;
  unitId?: string;
  facilityId?: string;
  date?: string;
  /** REVISION-56 H4 — rango inclusivo (alternativa a `date`). */
  dateFrom?: string;
  dateTo?: string;
}): Promise<
  (TimeSlot & {
    occupied: boolean;
    bookingId?: string;
    bookingUserId?: string;
  })[]
> {
  let unitIds: string[] | null = null;
  if (opts.unitId) {
    unitIds = [opts.unitId];
  } else if (opts.facilityId) {
    const fac = await getFacility(opts.facilityId);
    if (!fac || fac.municipalityId !== opts.municipalityId) {
      return [];
    }
    const us = await listUnits(opts.facilityId);
    unitIds = us.map((u) => u.id);
  }
  if (unitIds && unitIds.length === 0) return [];

  /* REVISION-56 H4: filtrar data/unidades en SQL. */
  const slotConds = [eq(t.timeSlots.municipalityId, opts.municipalityId)];
  if (unitIds) slotConds.push(inArray(t.timeSlots.unitId, unitIds));
  if (opts.date) {
    slotConds.push(eq(t.timeSlots.date, opts.date));
  } else {
    if (opts.dateFrom) slotConds.push(gte(t.timeSlots.date, opts.dateFrom));
    if (opts.dateTo) {
      slotConds.push(sql`${t.timeSlots.date} <= ${opts.dateTo}`);
    }
  }
  const rows = await getDb()
    .select()
    .from(t.timeSlots)
    .where(and(...slotConds));

  const bookingConds = [
    eq(t.bookings.municipalityId, opts.municipalityId),
    notInArray(t.bookings.status, ["cancelled", "no_show"]),
  ];
  if (opts.date) {
    bookingConds.push(eq(t.bookings.date, opts.date));
  } else if (opts.dateFrom || opts.dateTo) {
    if (opts.dateFrom) bookingConds.push(gte(t.bookings.date, opts.dateFrom));
    if (opts.dateTo) {
      bookingConds.push(sql`${t.bookings.date} <= ${opts.dateTo}`);
    }
  } else if (rows.length > 0) {
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    bookingConds.push(gte(t.bookings.date, dates[0]!));
    bookingConds.push(sql`${t.bookings.date} <= ${dates[dates.length - 1]!}`);
  }
  const bookings =
    rows.length === 0 && (opts.date || opts.dateFrom || opts.dateTo || unitIds)
      ? []
      : await getDb()
          .select()
          .from(t.bookings)
          .where(and(...bookingConds));
  const bySlot = new Map<string, { id: string; userId: string | null }>();
  /* REVISION-56 H4: Map por data+unidade para incompatibles. */
  const bookingsByDateUnit = new Map<string, typeof bookings>();
  for (const b of bookings) {
    if (!bySlot.has(b.slotId)) {
      bySlot.set(b.slotId, { id: b.id, userId: b.userId ?? null });
    }
    const key = `${b.date}|${b.unitId}`;
    const list = bookingsByDateUnit.get(key) ?? [];
    list.push(b);
    bookingsByDateUnit.set(key, list);
  }
  /* REVISION-50 A1: franxas incompatibles tamén ocupadas. */
  const unitRows = await getDb().select().from(t.units).where(
    eq(t.units.municipalityId, opts.municipalityId),
  );
  const incompatByUnit = new Map<string, Set<string>>();
  for (const u of unitRows) {
    const set = new Set<string>([u.id, ...(u.incompatibleWith ?? [])]);
    incompatByUnit.set(u.id, set);
  }
  for (const u of unitRows) {
    for (const otherId of u.incompatibleWith ?? []) {
      const other = incompatByUnit.get(otherId) ?? new Set([otherId]);
      other.add(u.id);
      incompatByUnit.set(otherId, other);
    }
  }
  const { slotOccupiedByIncompatibleMapped } = await import("./unit-conflicts.js");
  const nowMs = Date.now();
  return rows.map((s: (typeof rows)[number]) => {
    const held =
      !!s.heldForUserId &&
      !!s.heldUntil &&
      s.heldUntil.getTime() > nowMs;
    const booking = bySlot.get(s.id);
    const incompatOccupied = slotOccupiedByIncompatibleMapped(
      s,
      bookingsByDateUnit,
      incompatByUnit,
    );
    return {
      ...mapSlot(s),
      occupied: !!booking || held || incompatOccupied,
      bookingId: booking?.id,
      bookingUserId: booking?.userId ?? undefined,
    };
  });
}

export async function createBooking(input: {
  municipalityId: string;
  slotId: string;
  userId: string;
  userDisplayName: string;
  forMemberId?: string;
  forMemberName?: string;
  bookedByStaff?: boolean;
  /** Rol do solicitante (REVISION-20 H2 whoCanBook). */
  userRole?: string;
  /** Versión das normas aceptadas (opcional). */
  rulesVersion?: string;
  /** Só tests: inxectar «agora». */
  now?: Date;
  /**
   * REVISION-41 O3: omitir correo de confirmación (p.ex. reserva+partido:
   * envíase despois de crear o partido).
   */
  skipNotify?: boolean;
}): Promise<Booking> {
  const db = getDb();
  const now = input.now ?? new Date();

  const muni = await getMunicipalityById(input.municipalityId);
  if (!muni) throw new Error("municipality_not_found");
  const tz = muniTimezone(muni);
  const today = localDateIso(now, tz);

  const slots = await db
    .select()
    .from(t.timeSlots)
    .where(eq(t.timeSlots.id, input.slotId))
    .limit(1);
  const slot = slots[0];
  if (!slot || slot.municipalityId !== input.municipalityId) {
    throw new Error("slot_not_found");
  }
  if (slot.closed) throw new Error("slot_closed");

  const unitsForFacility = await db
    .select()
    .from(t.units)
    .where(eq(t.units.id, slot.unitId))
    .limit(1);
  const unitRow = unitsForFacility[0];
  if (!unitRow) throw new Error("unit_not_found");
  const facility = await getFacility(unitRow.facilityId);
  const usage = resolveFacilityRules(muni, facility ?? null);

  /* REVISION-20 H2: quen pode reservar. */
  const who = usage.whoCanBook ?? "ambas";
  const role = input.userRole ?? "citizen";
  const isStaffBook =
    !!input.bookedByStaff ||
    role === "admin" ||
    role === "staff" ||
    role === "monitor" ||
    role === "superadmin";
  if (!isStaffBook) {
    if (who === "clubs" && role !== "club_manager") {
      throw new Error("who_cannot_book");
    }
    if (who === "vecinhaza" && role === "club_manager") {
      throw new Error("who_cannot_book");
    }
  }

  // Franxa apartada para outra persoa (lista de espera).
  if (
    slot.heldForUserId &&
    slot.heldUntil &&
    slot.heldUntil.getTime() > now.getTime() &&
    slot.heldForUserId !== input.userId
  ) {
    throw new Error("slot_held");
  }

  /* REVISION-44 S1: start <= agora → slot_in_past (mesma regra que a API pública). */
  if (isSlotInPast(slot.date, slot.start, now, tz)) {
    throw new Error("slot_in_past");
  }

  const antelation = usage.bookingAntelationDays;
  const maxDate = addDaysIso(today, antelation);
  if (slot.date > maxDate) {
    throw new Error("antelation_exceeded");
  }

  let forMemberId = input.forMemberId ?? null;
  let forMemberName = input.forMemberName ?? null;
  if (!input.bookedByStaff && (forMemberId || forMemberName)) {
    if (!forMemberId) throw new Error("family_member_required");
    const famRows = await db
      .select()
      .from(t.familyMembers)
      .where(
        and(
          eq(t.familyMembers.id, forMemberId),
          eq(t.familyMembers.userId, input.userId),
        ),
      )
      .limit(1);
    const fam = famRows[0];
    if (!fam) throw new Error("family_member_forbidden");
    forMemberName = fam.displayName;
  }

  /* REVISION-21 Q3: bloqueo por penalización de non presentados. */
  if (!input.bookedByStaff) {
    const userRows = await db
      .select({ bookingBlockedUntil: t.users.bookingBlockedUntil })
      .from(t.users)
      .where(eq(t.users.id, input.userId))
      .limit(1);
    const blockedUntil = userRows[0]?.bookingBlockedUntil;
    if (blockedUntil && blockedUntil.getTime() > now.getTime()) {
      throw new Error("booking_blocked");
    }
  }

  const usageLimits = usage;

  const maxHours = usageLimits.maxHoursPerWeek;
  if (!input.bookedByStaff && maxHours > 0) {
    const ws = weekStartIso(slot.date);
    const we = addDaysIso(ws, 6);
    const weekBookings = await db
      .select()
      .from(t.bookings)
      .where(
        and(
          eq(t.bookings.municipalityId, input.municipalityId),
          eq(t.bookings.userId, input.userId),
          ne(t.bookings.status, "cancelled"),
          gte(t.bookings.date, ws),
          sql`${t.bookings.date} <= ${we}`,
        ),
      );
    const used = weekBookings.reduce(
      (sum, b) => sum + slotDurationHours(b.start, b.end),
      0,
    );
    const add = slotDurationHours(slot.start, slot.end);
    if (used + add > maxHours + 1e-9) {
      throw new Error("weekly_hours_exceeded");
    }
  }

  const unit = unitRow;

  const shortCode = makeShortCode();
  const id = randomUUID();
  const display = forMemberName
    ? `${input.userDisplayName} (en nome de ${forMemberName})`
    : input.userDisplayName;
  const qrPayload = signQrPayload(id, slot.date, shortCode);
  const createdAt = new Date();
  /* REVISION-20 H2: require aprobación → Pendente (agás reserva en nome do persoal). */
  let status =
    usage.approvalRequired && !input.bookedByStaff ? "pending" : "confirmed";
  let acceptedRulesVersion =
    input.rulesVersion ?? muni.settings.rulesVersion ?? null;

  /*
   * REVISION-43 R9: solape + insert na mesma transacción con
   * pg_advisory_xact_lock(hashtext(userId)) para carreiras en Postgres.
   * REVISION-44 S3: maxActiveBookings dentro do mesmo bloqueo.
   * REVISION-50 A1: bloqueo por instalación + unidades incompatibles.
   */
  try {
    await db.transaction(async (tx) => {
      await lockBookingResources(tx, {
        facilityIds: [unit.facilityId],
        userIds: [input.userId],
      });
      /*
       * Serializa coa baixa de conta. A comprobación faise baixo o mesmo lock:
       * se a baixa gaña, non pode crearse unha reserva para unha conta inactiva;
       * se a reserva gaña, a baixa vera e cancelara esa reserva.
       */
      await tx.execute(
        sql`select id from users where id = ${input.userId} for update`,
      );
      const [bookingUser] = await tx
        .select({ active: t.users.active })
        .from(t.users)
        .where(eq(t.users.id, input.userId))
        .limit(1);
      if (bookingUser && !bookingUser.active) {
        throw new Error("account_inactive");
      }
      const freshSlot = (
        await tx
          .select()
          .from(t.timeSlots)
          .where(eq(t.timeSlots.id, input.slotId))
          .limit(1)
      )[0];
      if (!freshSlot || freshSlot.municipalityId !== input.municipalityId) {
        throw new Error("slot_not_found");
      }
      if (freshSlot.unitId !== unit.id) throw new Error("slot_changed");
      if (freshSlot.closed) throw new Error("slot_closed");
      if (
        freshSlot.heldForUserId &&
        freshSlot.heldUntil &&
        freshSlot.heldUntil.getTime() > now.getTime() &&
        freshSlot.heldForUserId !== input.userId
      ) {
        throw new Error("slot_held");
      }
      const freshMuniRow = (
        await tx
          .select()
          .from(t.municipalities)
          .where(eq(t.municipalities.id, input.municipalityId))
          .limit(1)
      )[0];
      const freshFacilityRow = (
        await tx
          .select()
          .from(t.facilities)
          .where(eq(t.facilities.id, unit.facilityId))
          .limit(1)
      )[0];
      if (!freshMuniRow || !freshFacilityRow) {
        throw new Error("facility_not_found");
      }
      const freshMuni = mapMunicipality(freshMuniRow);
      const freshUsage = resolveFacilityRules(
        freshMuni,
        mapFacility(freshFacilityRow),
      );
      const freshTz = muniTimezone(freshMuni);
      const freshToday = localDateIso(now, freshTz);
      if (isSlotInPast(freshSlot.date, freshSlot.start, now, freshTz)) {
        throw new Error("slot_in_past");
      }
      if (
        freshSlot.date >
        addDaysIso(freshToday, freshUsage.bookingAntelationDays)
      ) {
        throw new Error("antelation_exceeded");
      }
      const freshWho = freshUsage.whoCanBook ?? "ambas";
      if (
        !isStaffBook &&
        ((freshWho === "clubs" && role !== "club_manager") ||
          (freshWho === "vecinhaza" && role === "club_manager"))
      ) {
        throw new Error("who_cannot_book");
      }
      status =
        freshUsage.approvalRequired && !input.bookedByStaff
          ? "pending"
          : "confirmed";
      acceptedRulesVersion =
        input.rulesVersion ?? freshMuni.settings.rulesVersion ?? null;

      if (!input.bookedByStaff && freshUsage.maxActiveBookings > 0) {
        /* REVISION-46 T1: só reservas que aínda non acabaron. */
        const nowHm = (() => {
          const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: muniTimezone(muni),
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).formatToParts(now);
          const h = parts.find((p) => p.type === "hour")?.value ?? "00";
          const m = parts.find((p) => p.type === "minute")?.value ?? "00";
          return `${h}:${m}`;
        })();
        const activeRows = await tx
          .select()
          .from(t.bookings)
          .where(
            and(
              eq(t.bookings.municipalityId, input.municipalityId),
              eq(t.bookings.userId, input.userId),
              inArray(t.bookings.status, ["confirmed", "pending"]),
              gte(t.bookings.date, freshToday),
            ),
          );
        const active = activeRows.filter(
          (b) =>
            b.date > freshToday ||
            (b.date === freshToday && b.end > nowHm),
        );
        if (active.length >= freshUsage.maxActiveBookings) {
          throw new Error("booking_limit_exceeded");
        }
      }
      if (!input.bookedByStaff && freshUsage.maxHoursPerWeek > 0) {
        const ws = weekStartIso(freshSlot.date);
        const we = addDaysIso(ws, 6);
        const weekBookings = await tx
          .select()
          .from(t.bookings)
          .where(
            and(
              eq(t.bookings.municipalityId, input.municipalityId),
              eq(t.bookings.userId, input.userId),
              ne(t.bookings.status, "cancelled"),
              gte(t.bookings.date, ws),
              sql`${t.bookings.date} <= ${we}`,
            ),
          );
        const used = weekBookings.reduce(
          (sum, booking) =>
            sum + slotDurationHours(booking.start, booking.end),
          0,
        );
        if (
          used +
            slotDurationHours(freshSlot.start, freshSlot.end) >
          freshUsage.maxHoursPerWeek + 1e-9
        ) {
          throw new Error("weekly_hours_exceeded");
        }
      }
      const { assertNoPersonalOverlap } = await import("./booking-overlap.js");
      await assertNoPersonalOverlap({
        municipalityId: input.municipalityId,
        userId: input.userId,
        date: freshSlot.date,
        start: freshSlot.start,
        end: freshSlot.end,
        skip: !!input.bookedByStaff || !!forMemberId,
        db: tx as unknown as ReturnType<typeof getDb>,
      });
      const { assertNoIncompatibleBookingOverlap } = await import(
        "./unit-conflicts.js"
      );
      await assertNoIncompatibleBookingOverlap({
        municipalityId: input.municipalityId,
        unitId: unit.id,
        date: freshSlot.date,
        start: freshSlot.start,
        end: freshSlot.end,
        db: tx as unknown as ReturnType<typeof getDb>,
      });
      await tx.insert(t.bookings).values({
        id,
        municipalityId: input.municipalityId,
        unitId: unit.id,
        facilityId: unit.facilityId,
        userId: input.userId,
        userDisplayName: display,
        slotId: freshSlot.id,
        date: freshSlot.date,
        start: freshSlot.start,
        end: freshSlot.end,
        status,
        shortCode,
        qrPayload,
        forMemberId,
        forMemberName,
        bookedByStaff: !!input.bookedByStaff,
        rulesVersion: acceptedRulesVersion,
        createdAt,
      });
      if (freshSlot.heldForUserId || freshSlot.heldUntil) {
        await tx
          .update(t.timeSlots)
          .set({ heldForUserId: null, heldUntil: null })
          .where(eq(t.timeSlots.id, freshSlot.id));
      }
    });
  } catch (err) {
    const { OverlappingBookingError } = await import("./booking-overlap.js");
    if (err instanceof OverlappingBookingError) throw err;
    if (err instanceof Error && err.message === "slot_occupied") throw err;
    if (isUniqueViolation(err)) throw new Error("slot_occupied");
    throw err;
  }

  const created: Booking = {
    id,
    municipalityId: input.municipalityId,
    unitId: unit.id,
    facilityId: unit.facilityId,
    userId: input.userId,
    userDisplayName: display,
    slotId: slot.id,
    date: slot.date,
    start: slot.start,
    end: slot.end,
    status: status as Booking["status"],
    shortCode,
    qrPayload,
    rulesVersion: acceptedRulesVersion ?? undefined,
    createdAt: createdAt.toISOString(),
  };
  if (!input.skipNotify) {
    try {
      const { notifyBookingCreated } = await import(
        "../notify/emails/send-booking-lifecycle.js"
      );
      await notifyBookingCreated(created);
    } catch (err) {
      console.warn(
        `[mail] confirmación reserva ${created.id}: ${(err as Error).message}`,
      );
    }
  }
  return created;
}

let bookingApprovalAuditFailureInjector: (() => void) | undefined;

/** Test hook: a failure must abort approval instead of disappearing. */
export function setBookingApprovalAuditFailureInjector(
  injector: (() => void) | undefined,
): void {
  bookingApprovalAuditFailureInjector = injector;
}

/** REVISION-20 H2: aprobar reserva pendente. */
export async function approvePendingBooking(
  municipalityId: string,
  bookingId: string,
  actor: string,
): Promise<Booking> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.id, bookingId),
        eq(t.bookings.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const b = rows[0];
  if (!b) throw new Error("not_found");
  if (b.status !== "pending") throw new Error("not_pending");
  if (!b.userId) throw new Error("booking_owner_missing");
  const { drainNotificationOutboxSafely, enqueueUserNotice } = await import(
    "../notify/notification-outbox.js"
  );
  const operationKey = `booking-approve:${bookingId}`;
  let approved!: Booking;
  await db.transaction(async (tx) => {
    await lockBookingResources(tx, {
      facilityIds: [b.facilityId],
      userIds: [b.userId],
    });
    await tx.execute(
      sql`select id from bookings where id = ${bookingId} for update`,
    );
    const current = (
      await tx
        .select()
        .from(t.bookings)
        .where(
          and(
            eq(t.bookings.id, bookingId),
            eq(t.bookings.municipalityId, municipalityId),
          ),
        )
        .limit(1)
    )[0];
    if (!current) throw new Error("not_found");
    if (current.status !== "pending") throw new Error("not_pending");
    if (!current.userId) throw new Error("booking_owner_missing");

    const slot = (
      await tx
        .select()
        .from(t.timeSlots)
        .where(eq(t.timeSlots.id, current.slotId))
        .limit(1)
    )[0];
    if (!slot || slot.municipalityId !== municipalityId) {
      throw new Error("slot_not_found");
    }
    if (slot.closed) throw new Error("slot_closed");
    const muniRow = (
      await tx
        .select()
        .from(t.municipalities)
        .where(eq(t.municipalities.id, municipalityId))
        .limit(1)
    )[0];
    const facilityRow = (
      await tx
        .select()
        .from(t.facilities)
        .where(eq(t.facilities.id, current.facilityId))
        .limit(1)
    )[0];
    if (!muniRow || !facilityRow) throw new Error("facility_not_found");
    const muni = mapMunicipality(muniRow);
    const usage = resolveFacilityRules(muni, mapFacility(facilityRow));
    const now = new Date();
    const tz = muniTimezone(muni);
    const today = localDateIso(now, tz);
    if (isSlotInPast(slot.date, slot.start, now, tz)) {
      throw new Error("slot_in_past");
    }
    if (slot.date > addDaysIso(today, usage.bookingAntelationDays)) {
      throw new Error("antelation_exceeded");
    }

    if (!current.bookedByStaff && usage.maxActiveBookings > 0) {
      const active = await tx
        .select()
        .from(t.bookings)
        .where(
          and(
            eq(t.bookings.municipalityId, municipalityId),
            eq(t.bookings.userId, current.userId),
            inArray(t.bookings.status, ["confirmed", "pending"]),
            ne(t.bookings.id, current.id),
            gte(t.bookings.date, today),
          ),
        );
      if (active.length >= usage.maxActiveBookings) {
        throw new Error("booking_limit_exceeded");
      }
    }
    if (!current.bookedByStaff && usage.maxHoursPerWeek > 0) {
      const ws = weekStartIso(slot.date);
      const we = addDaysIso(ws, 6);
      const sameWeek = await tx
        .select()
        .from(t.bookings)
        .where(
          and(
            eq(t.bookings.municipalityId, municipalityId),
            eq(t.bookings.userId, current.userId),
            ne(t.bookings.status, "cancelled"),
            ne(t.bookings.id, current.id),
            gte(t.bookings.date, ws),
            sql`${t.bookings.date} <= ${we}`,
          ),
        );
      const used = sameWeek.reduce(
        (sum, booking) =>
          sum + slotDurationHours(booking.start, booking.end),
        0,
      );
      if (
        used + slotDurationHours(slot.start, slot.end) >
        usage.maxHoursPerWeek + 1e-9
      ) {
        throw new Error("weekly_hours_exceeded");
      }
    }
    const { assertNoPersonalOverlap } = await import("./booking-overlap.js");
    await assertNoPersonalOverlap({
      municipalityId,
      userId: current.userId,
      date: slot.date,
      start: slot.start,
      end: slot.end,
      excludeBookingId: current.id,
      skip: current.bookedByStaff || !!current.forMemberId,
      db: tx as unknown as ReturnType<typeof getDb>,
    });
    const { assertNoIncompatibleBookingOverlap } = await import(
      "./unit-conflicts.js"
    );
    await assertNoIncompatibleBookingOverlap({
      municipalityId,
      unitId: current.unitId,
      date: slot.date,
      start: slot.start,
      end: slot.end,
      excludeBookingId: current.id,
      db: tx as unknown as ReturnType<typeof getDb>,
    });

    const updated = await tx
      .update(t.bookings)
      .set({ status: "confirmed" })
      .where(
        and(
          eq(t.bookings.id, bookingId),
          eq(t.bookings.municipalityId, municipalityId),
          eq(t.bookings.status, "pending"),
        ),
      )
      .returning();
    if (!updated[0]) throw new Error("not_pending");
    bookingApprovalAuditFailureInjector?.();
    await tx.insert(t.auditEvents).values({
      id: newId("au"),
      municipalityId,
      at: new Date(),
      actor,
      action: "booking.approve",
      detail: `${bookingId} · ${current.userDisplayName}`,
    });
    approved = { ...mapBooking(updated[0]), status: "confirmed" };
    /*
     * Aviso mínimo construído sen getDb()/bookingApprovedNotice: enrichir
     * dentro do tx en PGlite provoca deadlock na conexión única.
     */
    if (approved.userId) {
      await enqueueUserNotice(tx, operationKey, municipalityId, {
        operationKey,
        notice: {
          id: newId("n-appr"),
          municipalityId,
          userId: approved.userId,
          noticeType: "change",
          notifyType: "confirmacion",
          title: "Reserva aprobada",
          body: `${approved.userDisplayName} · ${approved.date} · ${approved.start}`,
          payload: {
            date: approved.date,
            start: approved.start,
            facilityId: approved.facilityId,
            shortCode: approved.shortCode,
          },
        },
      });
    }
  });
  await drainNotificationOutboxSafely(operationKey);
  return approved;
}

/** REVISION-20 H2: rexeitar reserva pendente (libera a franxa). */
export async function rejectPendingBooking(
  municipalityId: string,
  bookingId: string,
  actor: string,
  reason?: string,
): Promise<{ id: string; status: "cancelled" }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.id, bookingId),
        eq(t.bookings.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const b = rows[0];
  if (!b) throw new Error("not_found");
  if (b.status !== "pending") throw new Error("not_pending");
  const note = reason?.trim() || "Rexeitada polo concello";
  const updated = await db
    .update(t.bookings)
    .set({ status: "cancelled", cancelReason: note })
    .where(
      and(
        eq(t.bookings.id, bookingId),
        eq(t.bookings.municipalityId, municipalityId),
        eq(t.bookings.status, "pending"),
      ),
    )
    .returning();
  if (!updated[0]) throw new Error("not_pending");
  try {
    const { audit } = await import("./extra.js");
    await audit(
      municipalityId,
      actor,
      "booking.reject",
      `${bookingId} · ${b.userDisplayName}`,
    );
    const { notifyBookingRejected } = await import(
      "../notify/emails/send-booking-lifecycle.js"
    );
    await notifyBookingRejected(mapBooking(b));
  } catch {
    /* optional */
  }
  /* Liberar franxa → waitlist (mesmo camiño que cancelBooking). */
  for (const fn of cancelHooks) await fn(b.slotId, municipalityId);
  return { id: bookingId, status: "cancelled" };
}

export async function listPendingBookings(municipalityId: string) {
  const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
  const rows = await getDb()
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, municipalityId),
        eq(t.bookings.status, "pending"),
        gte(t.bookings.date, today),
      ),
    );
  return rows.map(mapBooking);
}

export async function listBookings(opts: {
  municipalityId: string;
  userId?: string;
  /** REVISION-58 H4-resto — filtrar por data en SQL. */
  date?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<Booking[]> {
  const conds = [eq(t.bookings.municipalityId, opts.municipalityId)];
  if (opts.userId) conds.push(eq(t.bookings.userId, opts.userId));
  if (opts.date) {
    conds.push(eq(t.bookings.date, opts.date));
  } else {
    if (opts.dateFrom) conds.push(gte(t.bookings.date, opts.dateFrom));
    if (opts.dateTo) {
      conds.push(sql`${t.bookings.date} <= ${opts.dateTo}`);
    }
  }
  const rows = await getDb()
    .select()
    .from(t.bookings)
    .where(and(...conds));
  return rows.map(mapBooking);
}

/** Reservas do usuario en todos os concellos (P1 / REVISION-17 R5). */
export async function listBookingsForAuthenticatedUser(user: {
  id: string;
  personIdentifier?: string | null;
}): Promise<
  Array<
    Booking & {
      municipalitySlug: string;
      municipalityName: string;
      municipalityLogoDataUrl?: string | null;
      facilityName?: string;
      checkInRequired?: boolean;
    }
  >
> {
  const db = getDb();
  let userIds = [user.id];
  if (user.personIdentifier) {
    const linked = await db
      .select({ id: t.users.id })
      .from(t.users)
      .where(eq(t.users.personIdentifier, user.personIdentifier));
    userIds = [...new Set(linked.map((r) => r.id))];
  }
  const rows = await db
    .select()
    .from(t.bookings)
    .where(inArray(t.bookings.userId, userIds));
  const out: Array<
    Booking & {
      municipalitySlug: string;
      municipalityName: string;
      municipalityLogoDataUrl?: string | null;
      facilityName?: string;
      checkInRequired?: boolean;
    }
  > = [];
  const muniCache = new Map<string, Municipality>();
  for (const row of rows) {
    const b = mapBooking(row);
    let muni = muniCache.get(b.municipalityId);
    if (!muni) {
      const loaded = await getMunicipalityById(b.municipalityId);
      if (loaded) muniCache.set(b.municipalityId, loaded);
      muni = loaded;
    }
    const facility = await getFacility(b.facilityId);
    out.push({
      ...b,
      municipalitySlug: muni?.slug ?? "",
      municipalityName: muni?.name ?? "",
      municipalityLogoDataUrl: muni?.settings.logoDataUrl ?? null,
      facilityName: facility?.name,
      checkInRequired: !!facility?.checkInRequired,
    });
  }
  return out;
}

export async function getBooking(id: string): Promise<Booking | undefined> {
  const rows = await getDb()
    .select()
    .from(t.bookings)
    .where(eq(t.bookings.id, id))
    .limit(1);
  return rows[0] ? mapBooking(rows[0]) : undefined;
}

export async function cancelBooking(
  id: string,
  userId: string,
  asStaff = false,
  reason?: string | null,
  now: Date = new Date(),
): Promise<Booking> {
  const initial = await getBooking(id);
  if (!initial) throw new Error("not_found");
  if (!asStaff && initial.userId !== userId) throw new Error("forbidden");
  if (initial.status === "cancelled") throw new Error("already_cancelled");
  if (initial.status === "no_show") throw new Error("not_cancellable");
  if (!asStaff && initial.status !== "confirmed" && initial.status !== "pending") {
    throw new Error("not_cancellable");
  }

  const cancelReason = reason?.trim() || null;
  let cancelledRow: Booking | null = null;

  await getDb().transaction(async (tx) => {
    await lockBookingResources(tx, {
      facilityIds: [initial.facilityId],
      userIds: initial.userId ? [initial.userId] : [],
    });
    await tx.execute(sql`select id from bookings where id = ${id} for update`);
    const currentRows = await tx
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.id, id))
      .limit(1);
    const current = currentRows[0];
    if (!current) throw new Error("not_found");
    if (!asStaff && current.userId !== userId) throw new Error("forbidden");
    if (current.status === "cancelled") throw new Error("already_cancelled");
    if (current.status === "no_show") throw new Error("not_cancellable");
    if (!asStaff && current.status !== "confirmed" && current.status !== "pending") {
      throw new Error("not_cancellable");
    }

    if (!asStaff) {
      const muniRows = await tx
        .select()
        .from(t.municipalities)
        .where(eq(t.municipalities.id, current.municipalityId))
        .limit(1);
      if (!muniRows[0]) throw new Error("municipality_not_found");
      const muni = mapMunicipality(muniRows[0]);
      const tz = muniTimezone(muni);
      const facRows = await tx
        .select()
        .from(t.facilities)
        .where(eq(t.facilities.id, current.facilityId))
        .limit(1);
      const facility = facRows[0] ? mapFacility(facRows[0]) : null;
      const usage = resolveFacilityRules(muni, facility);
      const startAt = slotInstant(current.date, current.start, tz);
      const minMs = usage.cancelMinHours * 3_600_000;
      if (startAt.getTime() - now.getTime() < minMs) {
        throw new Error("cancel_too_late");
      }
    }

    const updated = await tx
      .update(t.bookings)
      .set({ status: "cancelled", cancelReason })
      .where(
        and(
          eq(t.bookings.id, id),
          notInArray(t.bookings.status, ["cancelled", "no_show"]),
        ),
      )
      .returning();
    if (!updated[0]) {
      throw new Error("already_cancelled");
    }
    cancelledRow = mapBooking(updated[0]);
  });

  if (!cancelledRow) {
    throw new Error("already_cancelled");
  }
  const done: Booking = cancelledRow;

  for (const fn of cancelHooks) await fn(done.slotId, done.municipalityId);
  try {
    const { cancelOpenMatchForBooking } = await import("./open-matches.js");
    await cancelOpenMatchForBooking(
      id,
      cancelReason || "Cancelouse a reserva da pista.",
    );
  } catch (err) {
    console.warn("[open-match] cancel on booking failed", err);
  }
  return done;
}

/**
 * Modificación atómica: cambia a franxa mantendo id, código curto e QR.
 * Non conta a propia reserva no límite; non penaliza. Ofrece a franxa vella á waitlist.
 */
export async function modifyBooking(input: {
  bookingId: string;
  newSlotId: string;
  userId: string;
  now?: Date;
}): Promise<{ booking: Booking; previousSlotId: string }> {
  const db = getDb();
  const now = input.now ?? new Date();
  const initial = await getBooking(input.bookingId);
  if (!initial) throw new Error("not_found");
  if (initial.userId !== input.userId) throw new Error("forbidden");
  const targetBeforeLock = await db
    .select()
    .from(t.timeSlots)
    .where(eq(t.timeSlots.id, input.newSlotId))
    .limit(1);
  const preliminarySlot = targetBeforeLock[0];
  if (!preliminarySlot) throw new Error("slot_not_found");
  const preliminaryUnit = (
    await db
      .select()
      .from(t.units)
      .where(eq(t.units.id, preliminarySlot.unitId))
      .limit(1)
  )[0];
  if (!preliminaryUnit) throw new Error("unit_not_found");

  let previousSlotId = initial.slotId;
  try {
    await db.transaction(async (tx) => {
      await lockBookingResources(tx, {
        facilityIds: [initial.facilityId, preliminaryUnit.facilityId],
        userIds: [input.userId],
      });
      await tx.execute(
        sql`select id from bookings where id = ${input.bookingId} for update`,
      );
      const current = (
        await tx
          .select()
          .from(t.bookings)
          .where(eq(t.bookings.id, input.bookingId))
          .limit(1)
      )[0];
      if (!current) throw new Error("not_found");
      if (current.userId !== input.userId) throw new Error("forbidden");
      if (current.status !== "confirmed") throw new Error("not_modifiable");
      if (current.slotId !== initial.slotId) throw new Error("booking_changed");
      if (current.slotId === input.newSlotId) throw new Error("same_slot");

      const slot = (
        await tx
          .select()
          .from(t.timeSlots)
          .where(eq(t.timeSlots.id, input.newSlotId))
          .limit(1)
      )[0];
      if (!slot || slot.municipalityId !== current.municipalityId) {
        throw new Error("slot_not_found");
      }
      const unit = (
        await tx
          .select()
          .from(t.units)
          .where(eq(t.units.id, slot.unitId))
          .limit(1)
      )[0];
      if (!unit) throw new Error("unit_not_found");
      if (unit.facilityId !== preliminaryUnit.facilityId) {
        throw new Error("slot_changed");
      }
      if (slot.closed) throw new Error("slot_closed");
      if (
        slot.heldForUserId &&
        slot.heldUntil &&
        slot.heldUntil.getTime() > now.getTime() &&
        slot.heldForUserId !== input.userId
      ) {
        throw new Error("slot_held");
      }
      const muniRow = (
        await tx
          .select()
          .from(t.municipalities)
          .where(eq(t.municipalities.id, current.municipalityId))
          .limit(1)
      )[0];
      const oldFacilityRow = (
        await tx
          .select()
          .from(t.facilities)
          .where(eq(t.facilities.id, current.facilityId))
          .limit(1)
      )[0];
      const targetFacilityRow = (
        await tx
          .select()
          .from(t.facilities)
          .where(eq(t.facilities.id, unit.facilityId))
          .limit(1)
      )[0];
      if (!muniRow || !oldFacilityRow || !targetFacilityRow) {
        throw new Error("facility_not_found");
      }
      const muni = mapMunicipality(muniRow);
      const tz = muniTimezone(muni);
      const oldUsage = resolveFacilityRules(muni, mapFacility(oldFacilityRow));
      const targetUsage = resolveFacilityRules(
        muni,
        mapFacility(targetFacilityRow),
      );
      if (
        slotInstant(current.date, current.start, tz).getTime() -
          now.getTime() <
        oldUsage.cancelMinHours * 3_600_000
      ) {
        throw new Error("modify_too_late");
      }
      if (isSlotInPast(slot.date, slot.start, now, tz)) {
        throw new Error("slot_in_past");
      }
      const today = localDateIso(now, tz);
      if (
        slot.date >
        addDaysIso(today, targetUsage.bookingAntelationDays)
      ) {
        throw new Error("antelation_exceeded");
      }
      if (targetUsage.maxHoursPerWeek > 0) {
        const ws = weekStartIso(slot.date);
        const we = addDaysIso(ws, 6);
        const weekBookings = await tx
          .select()
          .from(t.bookings)
          .where(
            and(
              eq(t.bookings.municipalityId, current.municipalityId),
              eq(t.bookings.userId, input.userId),
              ne(t.bookings.status, "cancelled"),
              ne(t.bookings.id, current.id),
              gte(t.bookings.date, ws),
              sql`${t.bookings.date} <= ${we}`,
            ),
          );
        const used = weekBookings.reduce(
          (sum, booking) =>
            sum + slotDurationHours(booking.start, booking.end),
          0,
        );
        if (
          used + slotDurationHours(slot.start, slot.end) >
          targetUsage.maxHoursPerWeek + 1e-9
        ) {
          throw new Error("weekly_hours_exceeded");
        }
      }
      const { assertNoPersonalOverlap } = await import("./booking-overlap.js");
      await assertNoPersonalOverlap({
        municipalityId: current.municipalityId,
        userId: input.userId,
        date: slot.date,
        start: slot.start,
        end: slot.end,
        excludeBookingId: current.id,
        skip: current.bookedByStaff || !!current.forMemberId,
        db: tx as unknown as ReturnType<typeof getDb>,
      });
      const { assertNoIncompatibleBookingOverlap } = await import(
        "./unit-conflicts.js"
      );
      await assertNoIncompatibleBookingOverlap({
        municipalityId: current.municipalityId,
        unitId: unit.id,
        date: slot.date,
        start: slot.start,
        end: slot.end,
        excludeBookingId: current.id,
        db: tx as unknown as ReturnType<typeof getDb>,
      });
      previousSlotId = current.slotId;
      await tx
        .update(t.bookings)
        .set({
          slotId: slot.id,
          unitId: unit.id,
          facilityId: unit.facilityId,
          date: slot.date,
          start: slot.start,
          end: slot.end,
          icsSequence: (current.icsSequence ?? 0) + 1,
        })
        .where(eq(t.bookings.id, current.id));
      if (slot.heldForUserId || slot.heldUntil) {
        await tx
          .update(t.timeSlots)
          .set({ heldForUserId: null, heldUntil: null })
          .where(eq(t.timeSlots.id, slot.id));
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "slot_occupied") throw err;
    if (isUniqueViolation(err)) throw new Error("slot_occupied");
    throw err;
  }

  for (const fn of cancelHooks) {
    await fn(previousSlotId, initial.municipalityId);
  }

  const updated = await getBooking(initial.id);
  if (!updated) throw new Error("not_found");
  try {
    const { moveOpenMatchForBooking } = await import("./open-matches.js");
    await moveOpenMatchForBooking({
      bookingId: updated.id,
      date: updated.date,
      start: updated.start,
      end: updated.end,
      facilityId: updated.facilityId,
      unitId: updated.unitId,
    });
  } catch (err) {
    console.warn("[open-match] move on booking failed", err);
  }
  return { booking: updated, previousSlotId };
}

export async function checkInByQr(
  payload: string,
  municipalityId?: string,
  now: Date = new Date(),
): Promise<{
  valid: boolean;
  reason?: string;
  booking?: Booking;
}> {
  if (!verifyQrPayload(payload)) {
    return { valid: false, reason: "asinatura_invalida" };
  }
  const id = payload.split("|")[0]!;
  const b = await getBooking(id);
  if (!b) return { valid: false, reason: "reserva_inexistente" };
  if (municipalityId && b.municipalityId !== municipalityId) {
    return { valid: false, reason: "wrong_municipality" };
  }
  if (b.status === "cancelled") {
    return { valid: false, reason: "cancelada", booking: b };
  }
  if (b.status === "checked_in") {
    return { valid: false, reason: "xa_rexistrado", booking: b };
  }
  if (b.status !== "confirmed") {
    return { valid: false, reason: "estado_invalido", booking: b };
  }

  const muni = await getMunicipalityById(b.municipalityId);
  const tz = muniTimezone(muni);
  const today = localDateIso(now, tz);
  if (b.date !== today) {
    return { valid: false, reason: "dia_incorrecto", booking: b };
  }

  const marginMin =
    (muni ? rulesFromSettings(muni.settings).checkInMarginMinutes : null) ??
    QR_CHECKIN_MARGIN_MINUTES;
  const windowStart =
    slotInstant(b.date, b.start, tz).getTime() - marginMin * 60_000;
  const windowEnd =
    slotInstant(b.date, b.end, tz).getTime() + marginMin * 60_000;
  const tnow = now.getTime();
  if (tnow < windowStart || tnow > windowEnd) {
    return { valid: false, reason: "fora_de_ventan", booking: b };
  }

  await getDb()
    .update(t.bookings)
    .set({ status: "checked_in" })
    .where(eq(t.bookings.id, id));
  return { valid: true, booking: { ...b, status: "checked_in" } };
}

export async function pavilionWeekend(
  municipalityId: string,
  weekOffset = 0,
): Promise<{
  weekend: string;
  weekendEnd: string;
  matches: (MatchSlot & {
    homeTeam: string;
    awayTeam: string;
    club: string;
    unit: string;
  })[];
  conflicts: number;
  clubs: Club[];
  teams: Team[];
  swaps: SlotSwap[];
  /** REVISION-48 Y2/Y7 — unidades (incompatibleWith) + horarios de apertura. */
  units: Unit[];
  openingHours: Array<{
    unitId: string | null;
    weekday: number;
    open: string;
    close: string;
    validFrom: string | null;
    validTo: string | null;
  }>;
  /** REVISION-51 B1 — reservas da veciñanza (calendario concello, sen nome). */
  neighborBookings: Array<{
    id: string;
    date: string;
    start: string;
    end: string;
    unitId: string;
    unit: string;
  }>;
}> {
  const muni = await getMunicipalityById(municipalityId);
  const tz = muniTimezone(muni);
  const weekend = weekendSaturdayIso(new Date(), tz, weekOffset);
  const weekendEnd = addDaysIso(weekend, 1);

  const db = getDb();
  const matchRows = await db
    .select()
    .from(t.matches)
    .where(
      and(
        eq(t.matches.municipalityId, municipalityId),
        or(eq(t.matches.date, weekend), eq(t.matches.date, weekendEnd)),
      ),
    );
  const teamRows = await db
    .select()
    .from(t.teams)
    .where(eq(t.teams.municipalityId, municipalityId));
  const clubRows = await db
    .select()
    .from(t.clubs)
    .where(eq(t.clubs.municipalityId, municipalityId));
  const unitRows = await db
    .select()
    .from(t.units)
    .where(eq(t.units.municipalityId, municipalityId));
  const swapRows = await db
    .select()
    .from(t.slotSwaps)
    .where(eq(t.slotSwaps.municipalityId, municipalityId));

  const teams = teamRows.map(mapTeam);
  const clubs = clubRows.map(mapClub);
  const units = unitRows.map(mapUnit);
  const matches = matchRows.map(mapMatch);
  const enriched = matches.map((m: MatchSlot) => ({
    ...m,
    homeTeam: teams.find((x: Team) => x.id === m.homeTeamId)?.name ?? m.homeTeamId,
    awayTeam: teams.find((x: Team) => x.id === m.awayTeamId)?.name ?? m.awayTeamId,
    club: clubs.find((c: Club) => c.id === m.clubId)?.shortName ?? m.clubId,
    unit: units.find((u: Unit) => u.id === m.unitId)?.name ?? m.unitId,
  }));

  /* REVISION-18 T2: propostas pendentes (Proposto) na grella do club e do concello. */
  const pendingReqs = await db
    .select()
    .from(t.clubRequests)
    .where(
      and(
        eq(t.clubRequests.municipalityId, municipalityId),
        eq(t.clubRequests.status, "pending"),
        eq(t.clubRequests.type, "match"),
      ),
    );
  for (const req of pendingReqs) {
    const p = (req.payload ?? {}) as Record<string, unknown>;
    const date = String(p.date ?? "");
    if (date !== weekend && date !== weekendEnd) continue;
    const unitId = String(p.unitId ?? "");
    const club = clubs.find((c: Club) => c.id === req.clubId);
    enriched.push({
      id: `proposed-${req.id}`,
      municipalityId,
      facilityId: String(p.facilityId ?? ""),
      unitId,
      date,
      start: String(p.start ?? ""),
      end: String(p.end ?? ""),
      homeTeamId: "",
      awayTeamId: "",
      clubId: req.clubId,
      status: "proposed",
      conflictWith: [],
      notes: req.note ?? undefined,
      homeTeam: String(p.homeTeam ?? "Local"),
      awayTeam: String(p.awayTeam ?? "Visitante"),
      club: club?.shortName ?? req.clubId,
      unit: units.find((u: Unit) => u.id === unitId)?.name ?? unitId,
    });
  }

  const conflictPairs = new Set<string>();
  for (const m of enriched.filter((x: { status: string }) => x.status === "conflict")) {
    for (const other of m.conflictWith ?? []) {
      conflictPairs.add([m.id, other].sort().join("|"));
    }
  }

  /* Horarios das unidades do pavillón (apertura real para freeSlotStarts). */
  const pavFacilityIds = new Set(
    (
      await db
        .select({ id: t.facilities.id })
        .from(t.facilities)
        .where(
          and(
            eq(t.facilities.municipalityId, municipalityId),
            eq(t.facilities.type, "pavillon"),
          ),
        )
    ).map((r) => r.id),
  );
  const pavUnits = units.filter((u) => pavFacilityIds.has(u.facilityId));
  const pavUnitIds = new Set(pavUnits.map((u) => u.id));
  const hourRows = await db
    .select()
    .from(t.openingHours)
    .where(eq(t.openingHours.municipalityId, municipalityId));
  const openingHours = hourRows
    .filter((h) => h.unitId && pavUnitIds.has(h.unitId))
    .map((h) => ({
      unitId: h.unitId,
      weekday: h.weekday,
      open: h.open,
      close: h.close,
      validFrom: h.validFrom,
      validTo: h.validTo,
    }));

  /* REVISION-51 B1: reservas activas da fin de semana (sen nome na grella). */
  const bookingRows = await db
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, municipalityId),
        or(eq(t.bookings.date, weekend), eq(t.bookings.date, weekendEnd)),
        inArray(t.bookings.status, ["confirmed", "pending", "checked_in"]),
      ),
    );
  const neighborBookings = bookingRows
    .filter((b) => pavUnitIds.has(b.unitId))
    .map((b) => ({
      id: b.id,
      date: b.date,
      start: b.start,
      end: b.end,
      unitId: b.unitId,
      unit: units.find((u) => u.id === b.unitId)?.name ?? b.unitId,
    }));

  return {
    weekend,
    weekendEnd,
    matches: enriched,
    conflicts: conflictPairs.size,
    clubs,
    teams,
    swaps: swapRows.map(mapSwap),
    units: pavUnits,
    openingHours,
    neighborBookings,
  };
}

export async function proposeSwap(input: {
  municipalityId: string;
  fromMatchId: string;
  toMatchId: string;
  /** REVISION-50 A3 — club do actor (obrigatorio se non é admin). */
  actorClubId?: string | null;
  actorRole?: string;
}): Promise<SlotSwap> {
  const db = getDb();
  const fromRows = await db
    .select()
    .from(t.matches)
    .where(
      and(
        eq(t.matches.id, input.fromMatchId),
        eq(t.matches.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  const toRows = await db
    .select()
    .from(t.matches)
    .where(
      and(
        eq(t.matches.id, input.toMatchId),
        eq(t.matches.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  if (!fromRows[0] || !toRows[0]) {
    throw new Error("match_not_found");
  }
  const from = fromRows[0];
  /* REVISION-50 A3: o club só propón co seu propio partido.
   * Sen actorRole/actorClubId (chamada interna / admin legado) → permitir. */
  if (input.actorRole !== undefined || input.actorClubId !== undefined) {
    const isAdmin =
      input.actorRole === "admin" || input.actorRole === "superadmin";
    if (!isAdmin) {
      if (!input.actorClubId || from.clubId !== input.actorClubId) {
        throw new Error("forbidden");
      }
    }
  }
  const swap: SlotSwap = {
    id: newId("swap"),
    municipalityId: input.municipalityId,
    fromMatchId: input.fromMatchId,
    toMatchId: input.toMatchId,
    status: "proposed",
  };
  await db.insert(t.slotSwaps).values({
    id: swap.id,
    municipalityId: swap.municipalityId,
    fromMatchId: swap.fromMatchId,
    toMatchId: swap.toMatchId,
    status: swap.status,
  });
  return swap;
}

export async function resolveConflict(input: {
  municipalityId: string;
  matchId: string;
  action: "move_media" | "accept_swap" | "clear";
  swapId?: string;
  actor?: string;
}): Promise<MatchSlot> {
  const db = getDb();
  const rows = await db
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
  if (!match) throw new Error("not_found");

  if (input.action === "move_media") {
    /* REVISION-50 A3: media pista vía incompatibleWith (sen ids a man). */
    const { unitConflictSet } = await import("./unit-conflicts.js");
    const { moveMatch } = await import("./admin-ops.js");
    const unitRow = (
      await db.select().from(t.units).where(eq(t.units.id, match.unitId)).limit(1)
    )[0];
    const incompat = [...(await unitConflictSet(match.unitId))].filter(
      (id) => id !== match.unitId,
    );
    /* Preferir media (incompatibleWith length 1) sobre completa. */
    const candidates = await db
      .select()
      .from(t.units)
      .where(eq(t.units.facilityId, match.facilityId));
    const half = candidates.find(
      (u) =>
        incompat.includes(u.id) &&
        (u.incompatibleWith?.length ?? 0) === 1 &&
        u.id !== match.unitId,
    );
    const newUnit =
      half?.id ??
      incompat[0] ??
      (unitRow?.incompatibleWith?.[0] ?? match.unitId);
    if (newUnit === match.unitId) throw new Error("no_half_court");
    await moveMatch(
      input.municipalityId,
      match.id,
      {
        date: match.date,
        start: match.start,
        end: match.end,
        unitId: newUnit,
        facilityId: match.facilityId,
      },
      input.actor ?? "admin",
    );
    await db
      .update(t.matches)
      .set({
        status: "resolved",
        conflictWith: [],
        notes: "Resolto: movido a media pista",
      })
      .where(eq(t.matches.id, match.id));
  } else if (input.action === "accept_swap" && input.swapId) {
    const swaps = await db
      .select()
      .from(t.slotSwaps)
      .where(
        and(
          eq(t.slotSwaps.id, input.swapId),
          eq(t.slotSwaps.municipalityId, input.municipalityId),
        ),
      )
      .limit(1);
    const swap = swaps[0];
    if (!swap) throw new Error("swap_not_found");
    /* REVISION-50 A3: o concello só valida intercambios aceptados. */
    if (swap.status !== "accepted") throw new Error("swap_not_accepted");
    const aRows = await db
      .select()
      .from(t.matches)
      .where(
        and(
          eq(t.matches.id, swap.fromMatchId),
          eq(t.matches.municipalityId, input.municipalityId),
        ),
      )
      .limit(1);
    const bRows = await db
      .select()
      .from(t.matches)
      .where(
        and(
          eq(t.matches.id, swap.toMatchId),
          eq(t.matches.municipalityId, input.municipalityId),
        ),
      )
      .limit(1);
    const a = aRows[0];
    const b = bRows[0];
    if (!a || !b) throw new Error("match_not_found");
    const {
      assertMatchSlotTiming,
      clubRequestConflictsPreview,
      notifyMatchMovedToClubs,
    } = await import("./admin-ops.js");
    const { regenerateSlotsForUnitAhead } = await import("./slots-ahead.js");
    const { unitConflictSet } = await import("./unit-conflicts.js");

    const aSnap = {
      date: a.date,
      start: a.start,
      end: a.end,
      unitId: a.unitId,
      facilityId: a.facilityId,
    };
    const bSnap = {
      date: b.date,
      start: b.start,
      end: b.end,
      unitId: b.unitId,
      facilityId: b.facilityId,
    };

    await assertMatchSlotTiming({
      municipalityId: input.municipalityId,
      unitId: bSnap.unitId,
      date: bSnap.date,
      start: bSnap.start,
      end: bSnap.end,
    });
    await assertMatchSlotTiming({
      municipalityId: input.municipalityId,
      unitId: aSnap.unitId,
      date: aSnap.date,
      start: aSnap.start,
      end: aSnap.end,
    });

    const conflictsA = await clubRequestConflictsPreview(input.municipalityId, {
      ...bSnap,
      matchId: a.id,
      alsoSkipMatchId: b.id,
    });
    const conflictsB = await clubRequestConflictsPreview(input.municipalityId, {
      ...aSnap,
      matchId: b.id,
      alsoSkipMatchId: a.id,
    });
    if (conflictsA.length || conflictsB.length) {
      const err = new Error("conflict");
      (err as Error & { conflicts: unknown }).conflicts = [
        ...conflictsA,
        ...conflictsB,
      ];
      throw err;
    }

    await db
      .update(t.matches)
      .set({ ...bSnap, status: "swapped", conflictWith: [] })
      .where(eq(t.matches.id, a.id));
    await db
      .update(t.matches)
      .set({ ...aSnap, status: "swapped", conflictWith: [] })
      .where(eq(t.matches.id, b.id));
    await db
      .update(t.slotSwaps)
      .set({ status: "validated" })
      .where(eq(t.slotSwaps.id, swap.id));

    await notifyMatchMovedToClubs({
      municipalityId: input.municipalityId,
      matchId: a.id,
      ...bSnap,
      homeTeamId: a.homeTeamId,
      awayTeamId: a.awayTeamId,
      clubId: a.clubId,
      fromDate: aSnap.date,
      fromStart: aSnap.start,
    });
    await notifyMatchMovedToClubs({
      municipalityId: input.municipalityId,
      matchId: b.id,
      ...aSnap,
      homeTeamId: b.homeTeamId,
      awayTeamId: b.awayTeamId,
      clubId: b.clubId,
      fromDate: bSnap.date,
      fromStart: bSnap.start,
    });

    const regen = new Set<string>([aSnap.unitId, bSnap.unitId]);
    for (const u of await unitConflictSet(aSnap.unitId)) regen.add(u);
    for (const u of await unitConflictSet(bSnap.unitId)) regen.add(u);
    for (const uid of regen) {
      await regenerateSlotsForUnitAhead(input.municipalityId, uid).catch(
        (err) => {
          console.warn("[slots-ahead] regenerate after swap failed", uid, err);
        },
      );
    }
  } else {
    await db
      .update(t.matches)
      .set({
        status: "resolved",
        conflictWith: [],
        notes: "Resolto polo admin",
      })
      .where(eq(t.matches.id, match.id));
  }

  // Recalcular conflitos restantes
  const all = await db
    .select()
    .from(t.matches)
    .where(eq(t.matches.municipalityId, input.municipalityId));
  for (const m of all) {
    if (m.status === "conflict" && (m.conflictWith?.length ?? 0) > 0) {
      const still = (m.conflictWith ?? []).filter((id) => {
        const other = all.find((x) => x.id === id);
        return other && other.status === "conflict";
      });
      await db
        .update(t.matches)
        .set({
          conflictWith: still,
          status: still.length === 0 ? "resolved" : "conflict",
        })
        .where(eq(t.matches.id, m.id));
    }
  }

  const updated = await db
    .select()
    .from(t.matches)
    .where(eq(t.matches.id, input.matchId))
    .limit(1);
  return mapMatch(updated[0]!);
}

export async function listActivities(municipalityId: string): Promise<Activity[]> {
  const rows = await getDb()
    .select()
    .from(t.activities)
    .where(eq(t.activities.municipalityId, municipalityId));
  return rows.map(mapActivity);
}

export async function getActivity(id: string): Promise<Activity | undefined> {
  const rows = await getDb()
    .select()
    .from(t.activities)
    .where(eq(t.activities.id, id))
    .limit(1);
  return rows[0] ? mapActivity(rows[0]) : undefined;
}

export async function listApplicationsPublic(activityId: string): Promise<
  {
    applicationNumber: string;
    priorityGroup: string;
    status: string;
  }[]
> {
  const rows = await getDb()
    .select()
    .from(t.activityApplications)
    .where(eq(t.activityApplications.activityId, activityId));
  return rows.map((a) => ({
    applicationNumber: a.applicationNumber,
    priorityGroup: a.priorityGroup,
    status: a.status,
  }));
}

export async function runLottery(
  activityId: string,
  municipalityId?: string,
): Promise<{
  activity: Activity;
  accepted: string[];
  waitlist: string[];
}> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select id from activities where id = ${activityId} for update`,
    );
    const act = (
      await tx
        .select()
        .from(t.activities)
        .where(eq(t.activities.id, activityId))
        .limit(1)
    )[0];
    if (!act) throw new Error("not_found");
    if (municipalityId && act.municipalityId !== municipalityId) {
      throw new Error("wrong_municipality");
    }
    if (act.method !== "lottery") throw new Error("not_lottery");
    if (act.lotteryStatus === "drawn") throw new Error("already_drawn");
    const secret = act.lotterySecret;
    if (!secret || !act.lotterySeedHash) throw new Error("seed_missing");
    if (hashSecret(secret) !== act.lotterySeedHash) {
      throw new Error("seed_mismatch");
    }

    const apps = (
      await tx
        .select()
        .from(t.activityApplications)
        .where(eq(t.activityApplications.activityId, activityId))
    )
      .map(mapApplication)
      .sort((a, b) =>
        a.applicationNumber.localeCompare(b.applicationNumber),
      );
    const order = drawOrder(
      secret,
      apps.map((application) => ({
        applicationNumber: application.applicationNumber,
        priorityGroup: application.priorityGroup,
      })),
    );
    const accepted: string[] = [];
    const waitlist: string[] = [];
    for (let idx = 0; idx < order.length; idx++) {
      const applicationNumber = order[idx]!;
      const application = apps.find(
        (candidate) => candidate.applicationNumber === applicationNumber,
      )!;
      const status = idx < act.places ? "accepted" : "waitlist";
      await tx
        .update(t.activityApplications)
        .set({ status })
        .where(eq(t.activityApplications.id, application.id));
      (status === "accepted" ? accepted : waitlist).push(applicationNumber);
    }
    const updated = await tx
      .update(t.activities)
      .set({
        lotterySecret: secret,
        lotteryResultOrder: order,
        lotteryStatus: "drawn",
      })
      .where(
        and(
          eq(t.activities.id, activityId),
          ne(t.activities.lotteryStatus, "drawn"),
        ),
      )
      .returning();
    if (!updated[0]) throw new Error("already_drawn");
    return {
      activity: mapActivity(updated[0]),
      accepted,
      waitlist,
    };
  });
}

export async function verifyLottery(
  activityId: string,
  secret: string,
  municipalityId?: string,
): Promise<ReturnType<typeof verifyDraw> & { accepted: string[] }> {
  const act = await getActivity(activityId);
  if (!act) throw new Error("not_found");
  /* REVISION-39 L15 */
  if (municipalityId && act.municipalityId !== municipalityId) {
    throw new Error("wrong_municipality");
  }
  if (!act.lotterySeedHash || !act.lotteryResultOrder) {
    throw new Error("not_ready");
  }
  const appRows = await getDb()
    .select()
    .from(t.activityApplications)
    .where(eq(t.activityApplications.activityId, activityId));
  const apps = appRows
    .map(mapApplication)
    .sort((a, b) => a.applicationNumber.localeCompare(b.applicationNumber));
  const result = verifyDraw(
    secret,
    act.lotterySeedHash,
    apps.map((a) => ({
      applicationNumber: a.applicationNumber,
      priorityGroup: a.priorityGroup,
    })),
    act.lotteryResultOrder,
  );
  const accepted = act.lotteryResultOrder.slice(0, act.places);
  return { ...result, accepted };
}

/**
 * Inscrición cidadá: `priorityGroup` sempre «sorteo».
 * Renovación só via seed/admin (nunca do body do cliente).
 * REVISION-51 C1: `forMemberId` para familiares (idade por birthYear).
 */
export async function applyToActivity(input: {
  activityId: string;
  municipalityId: string;
  userId: string;
  forMemberId?: string | null;
}): Promise<ActivityApplication> {
  const db = getDb();
  const muniForDeadline = await getMunicipalityById(input.municipalityId);
  const tzDeadline =
    (muniForDeadline?.settings as { timezone?: string } | undefined)?.timezone ??
    DEFAULT_TIMEZONE;

  /*
   * Serializar cada actividade antes de validar o seu estado e capacidade.
   * Así a seguinte inscrición ve as filas inseridas pola transacción anterior.
   */
  const app = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from activities where id = ${input.activityId} for update`,
    );
    const act = (
      await tx
        .select()
        .from(t.activities)
        .where(eq(t.activities.id, input.activityId))
        .limit(1)
    )[0];
    if (!act || act.municipalityId !== input.municipalityId) {
      throw new Error("not_found");
    }
    if (act.lotteryStatus === "drawn" || act.lotteryStatus === "closed") {
      throw new Error("closed");
    }

    /* REVISION-56 H5: prazo vencido (día local do concello). */
    const todayLocal = localDateIso(new Date(), tzDeadline);
    const deadlineDay = String(act.deadline ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(deadlineDay) && todayLocal > deadlineDay) {
      throw new Error("deadline_passed");
    }

    const forMemberId: string | null = input.forMemberId?.trim() || null;
    let forMemberName: string | null = null;
    /* REVISION-52 C1b: actividades infantís (ageMax < 18) esixen familiar. */
    if (!forMemberId && act.ageMax < 18) {
      throw new Error("age_out_of_range");
    }
    if (forMemberId) {
      /*
       * A familia pertence globalmente á conta autenticada. municipalityId é
       * só a procedencia da alta, non un límite de uso: a parella
       * (id, userId) evita tanto fugas entre contas coma bloqueos entre
       * concellos para a mesma persoa.
       */
      const fam = await tx
        .select()
        .from(t.familyMembers)
        .where(
          and(
            eq(t.familyMembers.id, forMemberId),
            eq(t.familyMembers.userId, input.userId),
          ),
        )
        .limit(1);
      if (!fam[0]) throw new Error("family_member_forbidden");
      forMemberName = fam[0].displayName;
      const by = fam[0].birthYear;
      /* REVISION-57 W5: con idades na actividade, o familiar precisa ano. */
      if (by == null) {
        throw new Error("birth_year_required");
      }
      const year = Number(todayLocal.slice(0, 4));
      const age = year - by;
      if (age < act.ageMin || age > act.ageMax) {
        throw new Error("age_out_of_range");
      }
    }

    const existingQ = and(
      eq(t.activityApplications.activityId, act.id),
      eq(t.activityApplications.userId, input.userId),
      forMemberId
        ? eq(t.activityApplications.forMemberId, forMemberId)
        : sql`(${t.activityApplications.forMemberId} is null or ${t.activityApplications.forMemberId} = '')`,
    );
    const existing = await tx
      .select()
      .from(t.activityApplications)
      .where(existingQ)
      .limit(1);
    if (existing.length) throw new Error("already_applied");

    let status: ActivityApplication["status"] =
      act.method === "first_come" ? "accepted" : "pending";
    if (act.method === "first_come") {
      const acceptedRows = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(t.activityApplications)
        .where(
          and(
            eq(t.activityApplications.activityId, act.id),
            eq(t.activityApplications.status, "accepted"),
          ),
        );
      if (Number(acceptedRows[0]?.c ?? 0) >= act.places) {
        status = "waitlist";
      }
    }

    const countRows = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(t.activityApplications)
      .where(eq(t.activityApplications.activityId, act.id));
    const n = Number(countRows[0]?.c ?? 0) + 1;
    const applicationNumber = `req-${String(n).padStart(4, "0")}`;
    const created: ActivityApplication = {
      id: randomUUID(),
      activityId: input.activityId,
      municipalityId: input.municipalityId,
      userId: input.userId,
      forMemberId,
      forMemberName,
      applicationNumber,
      priorityGroup: "sorteo",
      status,
      createdAt: new Date().toISOString(),
    };
    try {
      await tx.insert(t.activityApplications).values({
        id: created.id,
        activityId: created.activityId,
        municipalityId: created.municipalityId,
        userId: created.userId,
        forMemberId: created.forMemberId,
        forMemberName: created.forMemberName,
        applicationNumber: created.applicationNumber,
        priorityGroup: created.priorityGroup,
        status: created.status,
        createdAt: new Date(created.createdAt),
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error("already_applied");
      throw err;
    }
    return created;
  });
  return app;
}

/** Anonimiza PII de reservas pasadas (conservación RGPD / SPEC). */
export async function anonymizePastBookings(
  now: Date = new Date(),
): Promise<number> {
  const db = getDb();
  const munis = await db.select().from(t.municipalities);
  let total = 0;
  for (const m of munis) {
    const days =
      (m.settings as { anonymizeAfterDays?: number }).anonymizeAfterDays ??
      DEFAULT_ANONYMIZE_AFTER_DAYS;
    const tz =
      (m.settings as { timezone?: string }).timezone ?? DEFAULT_TIMEZONE;
    const cutoff = addDaysIso(localDateIso(now, tz), -days);
    const result = await db
      .update(t.bookings)
      .set({
        /*
         * Retense a reserva para métricas e trazabilidade operativa, pero non
         * unha chave estable que permita unila de novo coa persoa.
         */
        userId: sql<string>`NULL`,
        userDisplayName: "Anonimizado",
        forMemberName: null,
        forMemberId: null,
      })
      .where(
        and(
          eq(t.bookings.municipalityId, m.id),
          sql`${t.bookings.date} < ${cutoff}`,
          sql`(${t.bookings.userId} is not null or ${t.bookings.userDisplayName} <> 'Anonimizado')`,
        ),
      );
    // drizzle rowCount varia por driver
    const n = (result as { rowCount?: number }).rowCount ?? 0;
    total += n;
  }
  if (total > 0) {
    console.info(`[privacy] anonimizadas ${total} reservas pasadas`);
  }
  return total;
}

export async function dashboardStats(municipalityId: string) {
  const muni = await getMunicipalityById(municipalityId);
  const today = localDateIso(new Date(), muniTimezone(muni));
  const weekStart = weekStartIso(today);
  const prevWeekStart = addDaysIso(weekStart, -7);
  const inRange = (date: string, start: string, endExclusive: string) =>
    date >= start && date < endExclusive;
  const weekEnd = addDaysIso(weekStart, 7);
  /* REVISION-56 H4 + REVISION-58 H4-resto: rango acotado en SQL. */
  const slotsFrom = addDaysIso(weekStart, -7 * 7);
  const slotsTo = addDaysIso(weekEnd, -1);
  const bookings = await listBookings({
    municipalityId,
    dateFrom: slotsFrom,
    dateTo: slotsTo,
  });
  const todayBookings = bookings.filter((b) => b.date === today);
  const confirmed = bookings.filter((b) => b.status === "confirmed").length;
  const checkedIn = bookings.filter((b) => b.status === "checked_in").length;
  const cancelled = bookings.filter((b) => b.status === "cancelled").length;
  const noShows = bookings.filter((b) => b.status === "no_show").length;
  const todayNoShows = todayBookings.filter((b) => b.status === "no_show").length;
  const facilities = await listFacilities(municipalityId);
  const slots = await listSlots({
    municipalityId,
    dateFrom: slotsFrom,
    dateTo: slotsTo,
  });

  const weekSlots = slots.filter((s) => inRange(s.date, weekStart, weekEnd));
  const prevWeekSlots = slots.filter((s) =>
    inRange(s.date, prevWeekStart, weekStart),
  );

  /* REVISION-46 V3: horas reservadas ESTA semana + % sobre horas abertas. */
  const weekBookings = bookings.filter(
    (b) => inRange(b.date, weekStart, weekEnd) && b.status !== "cancelled",
  );
  const unitFacility = new Map<string, string>();
  for (const f of facilities) {
    const us = await listUnits(f.id);
    for (const u of us) unitFacility.set(u.id, f.id);
  }
  const heat = facilities.map((f) => {
    const fb = weekBookings.filter((b) => b.facilityId === f.id);
    const hours = Math.round(
      fb.reduce((sum, b) => sum + slotDurationHours(b.start, b.end), 0) * 10,
    ) / 10;
    const openHours = Math.round(
      weekSlots
        .filter((s) => unitFacility.get(s.unitId) === f.id && !s.closed)
        .reduce((sum, s) => sum + slotDurationHours(s.start, s.end), 0) * 10,
    ) / 10;
    const pct = openHours > 0 ? Math.round((hours / openHours) * 100) : 0;
    return {
      facilityId: f.id,
      name: f.name,
      bookings: hours,
      hours,
      openHours,
      pct,
    };
  });

  /* REVISION-46 V3: franxas futuras desta semana con ocupación histórica < 30 %. */
  const histKey = (s: { date: string; start: string }) => {
    const d = new Date(`${s.date}T12:00:00Z`);
    return `${d.getUTCDay()}|${s.start}`;
  };
  const histStats = new Map<string, { busy: number; total: number }>();
  for (const s of slots) {
    if (s.closed) continue;
    const key = histKey(s);
    const st = histStats.get(key) ?? { busy: 0, total: 0 };
    st.total += 1;
    if (s.occupied) st.busy += 1;
    histStats.set(key, st);
  }
  const nowHm = (() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: muniTimezone(muni),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${h}:${m}`;
  })();
  const isFutureSlot = (s: { date: string; start: string }) =>
    s.date > today || (s.date === today && s.start > nowHm);
  const lowOccupancy = weekSlots
    .filter((s) => !s.occupied && !s.closed && isFutureSlot(s))
    .filter((s) => {
      const st = histStats.get(histKey(s));
      if (!st || st.total === 0) return false;
      return st.busy / st.total < 0.3;
    })
    .slice(0, 8)
    .map((s) => ({ id: s.id, date: s.date, start: s.start, unitId: s.unitId }));

  /* REVISION-46 V3: un só número = lista de espera de franxas activa. */
  const waitRows = await getDb()
    .select({ id: t.waitlistEntries.id })
    .from(t.waitlistEntries)
    .where(
      and(
        eq(t.waitlistEntries.municipalityId, municipalityId),
        inArray(t.waitlistEntries.status, ["waiting", "offered"]),
      ),
    );
  const demandUnmet = waitRows.length;
  const weekOccPct = (list: typeof slots) => {
    const usable = list.filter((s) => !s.closed);
    if (usable.length === 0) return 0;
    const busy = usable.filter((s) => s.occupied).length;
    return Math.round((busy / usable.length) * 100);
  };
  const weekOccupancy = weekOccPct(weekSlots);
  const prevWeekOccupancy = weekOccPct(prevWeekSlots);
  /* REVISION-20 H4: tendencia de 4 semanas (máis antiga → actual). */
  const occupancyWeeks = [3, 2, 1, 0].map((weeksAgo) => {
    const start = addDaysIso(weekStart, -7 * weeksAgo);
    return weekOccPct(
      slots.filter((s) => inRange(s.date, start, addDaysIso(start, 7))),
    );
  });
  // Mesma fonte que o KPI: franxas ocupadas da semana civil → grella OccupancyGrid.
  const weekHeat = weekSlots
    .filter((s) => s.occupied && !s.closed && inRange(s.date, weekStart, weekEnd))
    .map((s) => ({ date: s.date, start: s.start, end: s.end }));

  const spark = (n: number) => {
    const out: number[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDaysIso(today, -i);
      out.push(bookings.filter((b) => b.date === d && b.status !== "cancelled").length);
    }
    return out;
  };
  const sparkNoShow = (n: number) => {
    const out: number[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDaysIso(today, -i);
      out.push(bookings.filter((b) => b.date === d && b.status === "no_show").length);
    }
    return out;
  };
  const sparkOcc = (n: number) => {
    const out: number[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDaysIso(today, -i);
      const daySlots = slots.filter((s) => s.date === d && !s.closed);
      if (daySlots.length === 0) {
        out.push(0);
        continue;
      }
      out.push(Math.round((daySlots.filter((s) => s.occupied).length / daySlots.length) * 100));
    }
    return out;
  };

  const prevWeekToday = addDaysIso(today, -7);
  const prevTodayCount = bookings.filter((b) => b.date === prevWeekToday && b.status !== "cancelled")
    .length;
  const prevTodayNoShows = bookings.filter(
    (b) => b.date === prevWeekToday && b.status === "no_show",
  ).length;

  const { openIncidentsCount } = await import("./incidents.js");
  const openIncidents = await openIncidentsCount(municipalityId);

  return {
    todayCount: todayBookings.filter((b) => b.status !== "cancelled").length,
    confirmed,
    checkedIn,
    cancelled,
    noShows,
    todayNoShows,
    weekOccupancy,
    occupancyWeeks,
    weekHeat,
    openIncidents,
    demandUnmet,
    heat,
    lowOccupancy,
    recommendation:
      "Franxas futuras desta semana cunha ocupación histórica inferior ao 30 %.",
    kpis: {
      bookingsToday: {
        value: todayBookings.filter((b) => b.status !== "cancelled").length,
        delta: todayBookings.filter((b) => b.status !== "cancelled").length - prevTodayCount,
        spark: spark(7),
      },
      weekOccupancy: {
        value: weekOccupancy,
        delta: weekOccupancy - prevWeekOccupancy,
        spark: sparkOcc(7),
        weeks: occupancyWeeks,
      },
      noShowsToday: {
        value: todayNoShows,
        delta: todayNoShows - prevTodayNoShows,
        spark: sparkNoShow(7),
      },
      openIncidents: {
        value: openIncidents,
        delta: 0,
        spark: Array.from({ length: 7 }, () => openIncidents),
      },
    },
  };
}

export async function exportOpenData(municipalityId: string) {
  const facilities = await listFacilities(municipalityId);
  const geojson = {
    type: "FeatureCollection" as const,
    features: facilities.map((f) => ({
      type: "Feature" as const,
      properties: { id: f.id, name: f.name, type: f.type, address: f.address },
      geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
    })),
  };
  /* REVISION-56 H4: ocupación nun rango acotado (non todas as franxas). */
  const muni = await getMunicipalityById(municipalityId);
  const today = localDateIso(new Date(), muniTimezone(muni));
  const occupancy = (
    await listSlots({
      municipalityId,
      dateFrom: addDaysIso(today, -30),
      dateTo: addDaysIso(today, 14),
    })
  ).map((s) => ({
    unitId: s.unitId,
    date: s.date,
    start: s.start,
    end: s.end,
    status: s.closed ? "closed" : s.occupied ? "occupied" : "free",
  }));
  return { geojson, occupancy, facilities };
}

export async function staffDayList(municipalityId: string, date: string) {
  /* REVISION-58 H4-resto: filtrar a data en SQL. */
  const bookings = await listBookings({ municipalityId, date });
  const facilities = await listFacilities(municipalityId);
  const allUnits = await getDb()
    .select()
    .from(t.units)
    .where(eq(t.units.municipalityId, municipalityId));
  return bookings.map((b) => ({
    ...b,
    facilityName: facilities.find((f) => f.id === b.facilityId)?.name,
    unitName: allUnits.find((u) => u.id === b.unitId)?.name,
  }));
}

export async function rejectSwap(
  swapId: string,
  municipalityId: string,
  opts?: { actorClubId?: string | null; actorRole?: string },
): Promise<SlotSwap> {
  const rows = await getDb()
    .select()
    .from(t.slotSwaps)
    .where(
      and(
        eq(t.slotSwaps.id, swapId),
        eq(t.slotSwaps.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error("not_found");
  const swap = rows[0];
  /* REVISION-55 G3: igual có aceptar — só o club do outro partido ou admin. */
  const isAdmin =
    opts?.actorRole === "admin" || opts?.actorRole === "superadmin";
  if (!isAdmin) {
    const toMatch = (
      await getDb()
        .select()
        .from(t.matches)
        .where(
          and(
            eq(t.matches.id, swap.toMatchId),
            eq(t.matches.municipalityId, municipalityId),
          ),
        )
        .limit(1)
    )[0];
    if (!toMatch || !opts?.actorClubId || toMatch.clubId !== opts.actorClubId) {
      throw new Error("forbidden");
    }
  }
  if (swap.status !== "proposed") {
    throw new Error("not_pending");
  }
  await getDb()
    .update(t.slotSwaps)
    .set({ status: "rejected" })
    .where(eq(t.slotSwaps.id, swapId));
  return { ...mapSwap(swap), status: "rejected" };
}

export async function acceptSwapProposal(
  swapId: string,
  municipalityId: string,
  opts?: { actorClubId?: string | null; actorRole?: string },
): Promise<SlotSwap> {
  const rows = await getDb()
    .select()
    .from(t.slotSwaps)
    .where(
      and(
        eq(t.slotSwaps.id, swapId),
        eq(t.slotSwaps.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error("not_found");
  const swap = rows[0];
  /* REVISION-50 A3: só o club do outro partido pode aceptar. */
  const isAdmin =
    opts?.actorRole === "admin" || opts?.actorRole === "superadmin";
  if (!isAdmin) {
    const toMatch = (
      await getDb()
        .select()
        .from(t.matches)
        .where(
          and(
            eq(t.matches.id, swap.toMatchId),
            eq(t.matches.municipalityId, municipalityId),
          ),
        )
        .limit(1)
    )[0];
    if (!toMatch || !opts?.actorClubId || toMatch.clubId !== opts.actorClubId) {
      throw new Error("forbidden");
    }
  }
  await getDb()
    .update(t.slotSwaps)
    .set({ status: "accepted" })
    .where(eq(t.slotSwaps.id, swapId));
  return { ...mapSwap(swap), status: "accepted" };
}

/** Unused import guard — or/sql used in places. */
void or;

export async function listClubs(municipalityId: string): Promise<Club[]> {
  const rows = await getDb()
    .select()
    .from(t.clubs)
    .where(eq(t.clubs.municipalityId, municipalityId));
  return rows.map(mapClub);
}

export async function getClub(id: string): Promise<Club | undefined> {
  const rows = await getDb().select().from(t.clubs).where(eq(t.clubs.id, id)).limit(1);
  return rows[0] ? mapClub(rows[0]) : undefined;
}

export async function listTeams(municipalityId: string, clubId?: string): Promise<Team[]> {
  const rows = await getDb()
    .select()
    .from(t.teams)
    .where(eq(t.teams.municipalityId, municipalityId));
  const mapped = rows.map(mapTeam);
  return clubId ? mapped.filter((x) => x.clubId === clubId) : mapped;
}
