/**
 * REVISION-22 B4 — tempadas publicadas.
 * REVISION-58 K3 — retirar franxa de tempada (season_slot).
 */
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Season, SeasonSlot } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapSeason, mapSeasonCampaign } from "../db/mappers.js";
import { audit } from "./extra.js";
import { unitConflictSet } from "./unit-conflicts.js";
import { regenerateSlotsForUnitAhead } from "./slots-ahead.js";

export async function listSeasons(municipalityId: string): Promise<Season[]> {
  const rows = await getDb()
    .select()
    .from(t.seasons)
    .where(eq(t.seasons.municipalityId, municipalityId));
  return rows.map(mapSeasonCampaign);
}

export async function getSeason(
  municipalityId: string,
  id: string,
): Promise<Season | null> {
  const rows = await getDb()
    .select()
    .from(t.seasons)
    .where(
      and(eq(t.seasons.id, id), eq(t.seasons.municipalityId, municipalityId)),
    )
    .limit(1);
  return rows[0] ? mapSeasonCampaign(rows[0]) : null;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  );
}

async function assertSeasonInput(input: {
  municipalityId: string;
  startsAt: string;
  endsAt: string;
  facilityIds: string[];
}): Promise<void> {
  if (!isValidIsoDate(input.startsAt) || !isValidIsoDate(input.endsAt)) {
    throw new Error("invalid_dates");
  }
  if (input.startsAt > input.endsAt) throw new Error("dates_inverted");

  const facilityIds = [...new Set(input.facilityIds)];
  if (facilityIds.length === 0) return;
  const owned = await getDb()
    .select({ id: t.facilities.id })
    .from(t.facilities)
    .where(
      and(
        eq(t.facilities.municipalityId, input.municipalityId),
        inArray(t.facilities.id, facilityIds),
      ),
    );
  if (owned.length !== facilityIds.length) {
    throw new Error("facility_not_found");
  }
}

export async function createSeason(
  input: Omit<Season, "id" | "createdAt"> & { actor: string },
): Promise<Season> {
  const id = `season-${randomUUID().slice(0, 8)}`;
  const row = {
    id,
    municipalityId: input.municipalityId,
    name: input.name.trim(),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    facilityIds: input.facilityIds ?? [],
    criteriaGl: input.criteriaGl ?? "",
    criteriaEs: input.criteriaEs ?? "",
    published: !!input.published,
  };
  if (!row.name) throw new Error("name_required");
  await assertSeasonInput(row);
  await getDb().insert(t.seasons).values(row);
  await audit(
    input.municipalityId,
    input.actor,
    "season.create",
    `Creou tempada «${row.name}» (${row.startsAt}–${row.endsAt})`,
  );
  return { ...row, createdAt: new Date().toISOString() };
}

export async function updateSeason(
  municipalityId: string,
  id: string,
  patch: Partial<
    Pick<
      Season,
      | "name"
      | "startsAt"
      | "endsAt"
      | "facilityIds"
      | "criteriaGl"
      | "criteriaEs"
      | "published"
    >
  > & { actor: string },
): Promise<Season> {
  const existing = await getSeason(municipalityId, id);
  if (!existing) throw new Error("not_found");
  const next = {
    name: patch.name?.trim() || existing.name,
    startsAt: patch.startsAt ?? existing.startsAt,
    endsAt: patch.endsAt ?? existing.endsAt,
    facilityIds: patch.facilityIds ?? existing.facilityIds,
    criteriaGl: patch.criteriaGl ?? existing.criteriaGl,
    criteriaEs: patch.criteriaEs ?? existing.criteriaEs,
    published:
      patch.published !== undefined ? !!patch.published : existing.published,
  };
  await assertSeasonInput({ municipalityId, ...next });
  await getDb()
    .update(t.seasons)
    .set(next)
    .where(and(eq(t.seasons.id, id), eq(t.seasons.municipalityId, municipalityId)));
  await audit(
    municipalityId,
    patch.actor,
    patch.published === true
      ? "season.publish"
      : patch.published === false
        ? "season.unpublish"
        : "season.update",
    `Actualizou tempada «${next.name}» (published=${next.published})`,
  );
  return { ...existing, ...next };
}

export async function deleteSeason(
  municipalityId: string,
  id: string,
  actor: string,
): Promise<void> {
  const existing = await getSeason(municipalityId, id);
  if (!existing) throw new Error("not_found");
  const affectedUnitIds = await getDb().transaction(async (tx) => {
    const linkedSlots = await tx
      .select({ unitId: t.seasonSlots.unitId })
      .from(t.seasonSlots)
      .where(
        and(
          eq(t.seasonSlots.seasonId, id),
          eq(t.seasonSlots.municipalityId, municipalityId),
        ),
      );
    await tx
      .delete(t.seasonSlots)
      .where(
        and(
          eq(t.seasonSlots.seasonId, id),
          eq(t.seasonSlots.municipalityId, municipalityId),
        ),
      );
    await tx
      .delete(t.seasons)
      .where(
        and(
          eq(t.seasons.id, id),
          eq(t.seasons.municipalityId, municipalityId),
        ),
      );
    return [...new Set(linkedSlots.map((slot) => slot.unitId))];
  });

  const regen = new Set<string>();
  for (const unitId of affectedUnitIds) {
    for (const conflictingUnitId of await unitConflictSet(unitId)) {
      regen.add(conflictingUnitId);
    }
  }
  for (const unitId of regen) {
    await regenerateSlotsForUnitAhead(municipalityId, unitId, {
      days: 60,
    }).catch((err) => {
      console.warn(
        "[slots-ahead] regenerate after season delete failed",
        unitId,
        err,
      );
    });
  }
  await audit(
    municipalityId,
    actor,
    "season.delete",
    `Borrou tempada «${existing.name}»`,
  );
}

/** REVISION-58 K3 — retirar unha franxa de tempada e rexenerar unidades. */
export async function deleteSeasonSlot(
  municipalityId: string,
  slotId: string,
  actor: string,
): Promise<void> {
  const rows = await getDb()
    .select()
    .from(t.seasonSlots)
    .where(
      and(
        eq(t.seasonSlots.id, slotId),
        eq(t.seasonSlots.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("not_found");
  await getDb().delete(t.seasonSlots).where(eq(t.seasonSlots.id, slotId));
  const regen = await unitConflictSet(row.unitId);
  for (const uid of regen) {
    await regenerateSlotsForUnitAhead(municipalityId, uid, { days: 60 }).catch(
      (err) => {
        console.warn("[slots-ahead] regenerate after season slot delete failed", uid, err);
      },
    );
  }
  await audit(
    municipalityId,
    actor,
    "season_slot.delete",
    `Retirou franxa de tempada ${slotId} (${row.start}–${row.end})`,
  );
}

/** Aviso público para unha instalación (tempadas publicadas que a cobren). */
export async function publishedSeasonsForFacility(
  municipalityId: string,
  facilityId: string,
): Promise<Season[]> {
  const all = await listSeasons(municipalityId);
  return all.filter(
    (s) => s.published && s.facilityIds.includes(facilityId),
  );
}

export async function listSeasonSlotsForClub(
  municipalityId: string,
  clubId: string,
): Promise<Array<SeasonSlot & { season?: Season | null }>> {
  const slots = await getDb()
    .select()
    .from(t.seasonSlots)
    .where(
      and(
        eq(t.seasonSlots.municipalityId, municipalityId),
        eq(t.seasonSlots.clubId, clubId),
      ),
    );
  const seasons = await listSeasons(municipalityId);
  const byId = new Map(seasons.map((s) => [s.id, s]));
  return slots.map((r) => {
    const slot = mapSeason(r);
    return {
      ...slot,
      season: slot.seasonId ? byId.get(slot.seasonId) ?? null : null,
    };
  });
}

/** ICS BYDAY: 0=dom … 6=sáb → SU…SA */
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export function weekdayToByDay(weekday: number): string {
  return BYDAY[((weekday % 7) + 7) % 7]!;
}

/**
 * REVISION-23 R8 — primeiro día da semana correcta ≥ fromDate (YYYY-MM-DD).
 * weekday: 0=dom … 6=sáb (JS getUTCDay).
 */
export function firstWeekdayOnOrAfter(
  fromDate: string,
  weekday: number,
): string {
  const [y, m, d] = fromDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const target = ((weekday % 7) + 7) % 7;
  const cur = dt.getUTCDay();
  const add = (target - cur + 7) % 7;
  dt.setUTCDate(dt.getUTCDate() + add);
  return dt.toISOString().slice(0, 10);
}

/** UNTIL en UTC con Z (RFC 5545 con DTSTART;TZID=…). */
export function seasonUntilUtc(untilDate: string): string {
  const day = untilDate.replace(/-/g, "");
  /* Fin do día Europe/Madrid ≈ 21:59/22:59 UTC; usamos 21:59:59Z (CET) seguro. */
  return `${day}T215959Z`;
}

export function seasonSlotRrule(opts: {
  weekday: number;
  untilDate: string; // YYYY-MM-DD
}): string {
  return `FREQ=WEEKLY;BYDAY=${weekdayToByDay(opts.weekday)};UNTIL=${seasonUntilUtc(opts.untilDate)}`;
}
