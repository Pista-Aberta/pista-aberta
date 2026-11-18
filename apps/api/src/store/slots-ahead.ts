/**
 * REVISION-20 H1: xerar franxas para TODAS as unidades activas
 * desde horario semanal / especial / peches, ata hoxe + antelación + 1.
 * Idempotente; non só demo.
 * REVISION-21 L4.4: inserción por lotes con onConflictDoNothing.
 */
import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import {
  DEFAULT_TIMEZONE,
  addDaysIso,
  localDateIso,
  slotOverlapsClosureRange,
} from "./business-rules.js";
import { getMunicipalityById } from "./db.js";
import { resolveFacilityRules } from "./rules.js";
import type { Facility, Municipality } from "@pista-aberta/shared";

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minToHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return hhmmToMin(aStart) < hhmmToMin(bEnd) && hhmmToMin(bStart) < hhmmToMin(aEnd);
}

type HourRow = {
  weekday: number;
  open: string;
  close: string;
  validFrom: string | null;
  validTo: string | null;
};

export function hoursForDate(
  hours: HourRow[],
  date: string,
  weekday: number,
): HourRow[] {
  const special = hours.filter(
    (h) =>
      h.weekday === weekday &&
      h.validFrom &&
      h.validTo &&
      date >= h.validFrom &&
      date <= h.validTo,
  );
  if (special.length > 0) return special;
  return hours.filter((h) => h.weekday === weekday && !h.validFrom && !h.validTo);
}

function mapFacilityLite(r: {
  id: string;
  municipalityId: string;
  name: string;
  type: string;
  address: string;
  lat: string | null;
  lng: string | null;
  accessibility: string | null;
  services: unknown;
  rules: string | null;
  active: boolean;
  rulesOverride: Record<string, unknown> | null;
}): Facility {
  return {
    id: r.id,
    municipalityId: r.municipalityId,
    name: r.name,
    type: r.type as Facility["type"],
    address: r.address,
    lat: Number(r.lat ?? 0),
    lng: Number(r.lng ?? 0),
    accessibility: r.accessibility ?? "",
    services: Array.isArray(r.services) ? (r.services as string[]) : [],
    rules: r.rules ?? "",
    active: r.active,
    rulesOverride: (r.rulesOverride as Facility["rulesOverride"]) ?? null,
  };
}

type WantedSlot = {
  id: string;
  unitId: string;
  municipalityId: string;
  date: string;
  start: string;
  end: string;
  closed: boolean;
  closedReason: string | null;
};

/**
 * Xera / actualiza franxas futuras sen reserva para unha unidade.
 * @returns número de franxas inseridas ou marcadas pechadas de novo
 */
export async function regenerateSlotsForUnitAhead(
  municipalityId: string,
  unitId: string,
  opts?: {
    slotMinutes?: number;
    days?: number;
    /** Se true, borra franxas futuras sen reserva que xa non encaixen no horario. */
    pruneOrphans?: boolean;
  },
): Promise<number> {
  const db = getDb();
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) return 0;
  const tz = muni.settings.timezone ?? DEFAULT_TIMEZONE;
  const today = localDateIso(new Date(), tz);

  const unitRows = await db
    .select()
    .from(t.units)
    .where(and(eq(t.units.id, unitId), eq(t.units.municipalityId, municipalityId)))
    .limit(1);
  const unit = unitRows[0];
  if (!unit) return 0;

  const facRows = await db
    .select()
    .from(t.facilities)
    .where(eq(t.facilities.id, unit.facilityId))
    .limit(1);
  const facility = facRows[0] ? mapFacilityLite(facRows[0]) : null;
  const usage = resolveFacilityRules(muni as Municipality, facility);
  const days =
    opts?.days ??
    (process.env.NODE_ENV === "test" || process.env.PA_SLOTS_TEST_DAYS
      ? Number(process.env.PA_SLOTS_TEST_DAYS || 2)
      : Math.max(1, (usage.bookingAntelationDays ?? 7) + 1));
  /* REVISION-56 H1: slotMinutes < 15 → bucle infinito; forzar 60. */
  let slotMinutes = opts?.slotMinutes ?? unit.slotMinutes ?? 60;
  if (slotMinutes < 15) {
    console.warn(
      `[slots-ahead] slotMinutes=${slotMinutes} inválido para unidade ${unitId}; usando 60`,
    );
    slotMinutes = 60;
  }

  const hours = await db
    .select()
    .from(t.openingHours)
    .where(
      and(
        eq(t.openingHours.municipalityId, municipalityId),
        eq(t.openingHours.unitId, unitId),
      ),
    );
  if (hours.length === 0) return 0;

  const closures = await db
    .select()
    .from(t.closures)
    .where(eq(t.closures.municipalityId, municipalityId));

  const last = addDaysIso(today, days - 1);

  const matchRows = await db
    .select()
    .from(t.matches)
    .where(
      and(
        eq(t.matches.municipalityId, municipalityId),
        gte(t.matches.date, today),
        sql`${t.matches.date} <= ${last}`,
        inArray(t.matches.status, ["scheduled", "resolved", "swapped", "moved"]),
      ),
    );

  const seasonRows = await db
    .select()
    .from(t.seasonSlots)
    .where(eq(t.seasonSlots.municipalityId, municipalityId));
  /* REVISION-57 J4: campañas para limitar o bloqueo ao intervalo startsAt/endsAt. */
  const seasonCampaigns = await db
    .select()
    .from(t.seasons)
    .where(eq(t.seasons.municipalityId, municipalityId));
  const seasonById = new Map(seasonCampaigns.map((s) => [s.id, s]));

  /* REVISION-57 J7: grupos fixos activos bloquean como season_slots. */
  const fixedGroupRows = await db
    .select()
    .from(t.fixedGroups)
    .where(
      and(
        eq(t.fixedGroups.municipalityId, municipalityId),
        eq(t.fixedGroups.active, true),
      ),
    );

  const incompatible = new Set<string>([
    unitId,
    ...((unit.incompatibleWith as string[] | null) ?? []),
  ]);
  /* Tamén unidades que listan esta como incompatible. */
  const allUnits = await db
    .select()
    .from(t.units)
    .where(eq(t.units.municipalityId, municipalityId));
  for (const u of allUnits) {
    const inc = (u.incompatibleWith as string[] | null) ?? [];
    if (inc.includes(unitId)) incompatible.add(u.id);
  }

  const bookedSlotIds = new Set(
    (
      await db
        .select({ slotId: t.bookings.slotId })
        .from(t.bookings)
        .where(
          and(
            eq(t.bookings.municipalityId, municipalityId),
            notInArray(t.bookings.status, ["cancelled", "no_show"]),
            gte(t.bookings.date, today),
          ),
        )
    ).map((r) => r.slotId),
  );

  const wanted: WantedSlot[] = [];
  const wantedIds = new Set<string>();

  for (let i = 0; i < days; i++) {
    const date = addDaysIso(today, i);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const dayHours = hoursForDate(hours, date, dow);

    for (const h of dayHours) {
      let cursor = hhmmToMin(h.open);
      const end = hhmmToMin(h.close);
      while (cursor + slotMinutes <= end) {
        const start = minToHhmm(cursor);
        const slotEnd = minToHhmm(cursor + slotMinutes);
        const id = `slot-${unitId}-${date}-${start.replace(":", "")}`;
        wantedIds.add(id);

        /* REVISION-56 H2: solape data+hora [startsAt, endsAt), non só a data. */
        const closedByClosure = closures.some((c) => {
          if (c.unitId && c.unitId !== unitId) return false;
          if (c.facilityId && c.facilityId !== unit.facilityId && !c.unitId) {
            return false;
          }
          return slotOverlapsClosureRange(
            date,
            start,
            slotEnd,
            c.startsAt,
            c.endsAt,
            tz,
          );
        });

        const blockedByMatch = matchRows.some(
          (m) =>
            incompatible.has(m.unitId) &&
            m.date === date &&
            overlaps(start, slotEnd, m.start, m.end),
        );

        const blockedBySeason = seasonRows.some((s) => {
          if (!incompatible.has(s.unitId)) return false;
          if (s.weekday !== dow) return false;
          if (!overlaps(start, slotEnd, s.start, s.end)) return false;
          /* REVISION-57 J4: con campaña, só dentro de startsAt/endsAt. */
          if (s.seasonId) {
            const camp = seasonById.get(s.seasonId);
            if (!camp) return false;
            const from = camp.startsAt.slice(0, 10);
            const to = camp.endsAt.slice(0, 10);
            return date >= from && date <= to;
          }
          /* REVISION-58 K3: sen campaña, respectar validTo se existe. */
          if (s.validTo) return date <= s.validTo;
          /* Lexado sen seasonId nin validTo: bloqueo semanal indefinido. */
          return true;
        });

        const blockedByFixedGroup = fixedGroupRows.some(
          (g) =>
            incompatible.has(g.unitId) &&
            g.weekday === dow &&
            date >= g.validFrom &&
            date <= g.validTo &&
            overlaps(start, slotEnd, g.start, g.end),
        );

        const closed =
          closedByClosure ||
          blockedByMatch ||
          blockedBySeason ||
          blockedByFixedGroup;
        const reason = closedByClosure
          ? "peche"
          : blockedByMatch
            ? "partido"
            : blockedBySeason
              ? "tempada"
              : blockedByFixedGroup
                ? "grupo_fixo"
                : null;

        wanted.push({
          id,
          unitId,
          municipalityId,
          date,
          start,
          end: slotEnd,
          closed,
          closedReason: reason,
        });
        cursor += slotMinutes;
      }
    }
  }

  /* Franxas existentes no rango (unha query). */
  const existing = await db
    .select()
    .from(t.timeSlots)
    .where(
      and(
        eq(t.timeSlots.unitId, unitId),
        gte(t.timeSlots.date, today),
        sql`${t.timeSlots.date} <= ${last}`,
      ),
    );
  const existingByKey = new Map(
    existing.map((r) => [`${r.date}|${r.start}`, r] as const),
  );

  const toInsert: WantedSlot[] = [];
  const toUpdate: Array<{ id: string; closed: boolean; closedReason: string | null }> =
    [];

  for (const w of wanted) {
    const row = existingByKey.get(`${w.date}|${w.start}`);
    if (!row) {
      toInsert.push(w);
      continue;
    }
    wantedIds.add(row.id);
    if (bookedSlotIds.has(row.id)) continue;
    if (row.closed !== w.closed || row.closedReason !== w.closedReason) {
      toUpdate.push({
        id: row.id,
        closed: w.closed,
        closedReason: w.closedReason,
      });
    }
  }

  let touched = 0;

  /* Inserción por lotes. */
  const BATCH = 200;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH);
    await db
      .insert(t.timeSlots)
      .values(chunk)
      .onConflictDoNothing({
        target: [t.timeSlots.unitId, t.timeSlots.date, t.timeSlots.start],
      });
    touched += chunk.length;
  }

  for (const u of toUpdate) {
    await db
      .update(t.timeSlots)
      .set({ closed: u.closed, closedReason: u.closedReason })
      .where(eq(t.timeSlots.id, u.id));
    touched += 1;
  }

  if (opts?.pruneOrphans) {
    for (const s of existing) {
      if (wantedIds.has(s.id)) continue;
      /* Tamén polas chaves canónicas date|start. */
      if (wanted.some((w) => w.date === s.date && w.start === s.start)) continue;
      if (bookedSlotIds.has(s.id)) continue;
      await db.delete(t.timeSlots).where(eq(t.timeSlots.id, s.id));
      touched += 1;
    }
  }

  return touched;
}

/** Todas as unidades activas de todos os concellos. */
export async function ensureSlotsAhead(
  now: Date = new Date(),
  opts?: { days?: number },
): Promise<number> {
  void now;
  const db = getDb();
  const units = await db
    .select({
      id: t.units.id,
      municipalityId: t.units.municipalityId,
      facilityId: t.units.facilityId,
      slotMinutes: t.units.slotMinutes,
      active: t.facilities.active,
    })
    .from(t.units)
    .innerJoin(t.facilities, eq(t.facilities.id, t.units.facilityId));

  /* Unidades con horario (unha query). */
  const ohRows = await db
    .select({
      unitId: t.openingHours.unitId,
      municipalityId: t.openingHours.municipalityId,
    })
    .from(t.openingHours);
  const unitsWithHours = new Set(
    ohRows
      .filter((r) => r.unitId)
      .map((r) => `${r.municipalityId}|${r.unitId}`),
  );

  /* REVISION-21 L4 / REVISION-23 R15: en tests, poucos días. */
  const testDaysRaw =
    process.env.PA_SLOTS_DAYS_TEST || process.env.PA_SLOTS_TEST_DAYS || "3";
  const days =
    opts?.days ??
    (process.env.NODE_ENV === "test" ||
    process.env.PA_SLOTS_DAYS_TEST ||
    process.env.PA_SLOTS_TEST_DAYS
      ? Number(testDaysRaw)
      : undefined);

  let total = 0;
  for (const u of units) {
    if (!u.active) continue;
    if (!unitsWithHours.has(`${u.municipalityId}|${u.id}`)) continue;
    total += await regenerateSlotsForUnitAhead(u.municipalityId, u.id, {
      slotMinutes: u.slotMinutes ?? 60,
      days,
    });
  }
  return total;
}
