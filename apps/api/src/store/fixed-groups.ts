/**
 * Reservas de grupos fixos / trimestre (Rev3 D3).
 * REVISION-57 J7: bloquean franxas ao crear/desactivar (rexeneración).
 * REVISION-58 K1: rexenerar tamén unidades incompatibles.
 * REVISION-58 K2: impacto/confirmación se hai reservas nas horas bloqueadas.
 */
import { and, eq, inArray } from "drizzle-orm";
import { formatDayChip } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import {
  getFacility,
  getMunicipalityById,
  listUnits,
} from "./db.js";
import { newId } from "../lib/ids.js";
import {
  drainNotificationOutboxSafely,
  enqueueUserNotice,
} from "../notify/notification-outbox.js";
import { enrichClosureOutboxAlternatives } from "./admin-ops.js";
import { regenerateSlotsForUnitAhead } from "./slots-ahead.js";
import { timesOverlap, unitConflictSet } from "./unit-conflicts.js";
import {
  addDaysIso,
  localDateIso,
  localWeekday,
  DEFAULT_TIMEZONE,
} from "./business-rules.js";

function nid(prefix: string) {
  return newId(prefix);
}

/** REVISION-58 K1 — unidade do grupo + incompatibles. */
async function regenerateFixedGroupUnits(
  municipalityId: string,
  unitId: string,
): Promise<void> {
  const units = await unitConflictSet(unitId);
  for (const uid of units) {
    await regenerateSlotsForUnitAhead(municipalityId, uid, { days: 60 }).catch(
      (err) => {
        console.warn("[slots-ahead] regenerate after fixed group failed", uid, err);
      },
    );
  }
}

/** Datas do weekday no intervalo [from, to] (só dende hoxe). */
function weekdaysInRange(
  from: string,
  to: string,
  weekday: number,
  tz: string,
): string[] {
  const today = localDateIso(new Date(), tz);
  const start = from > today ? from : today;
  const out: string[] = [];
  let d = start;
  while (d <= to) {
    if (localWeekday(d, tz) === weekday) out.push(d);
    d = addDaysIso(d, 1);
  }
  return out;
}

/** REVISION-58 K2 — reservas confirmadas/pendentes nas horas do grupo. */
export async function previewFixedGroupImpact(
  municipalityId: string,
  input: {
    unitId: string;
    weekday: number;
    start: string;
    end: string;
    validFrom: string;
    validTo: string;
  },
) {
  const muni = await getMunicipalityById(municipalityId);
  const tz =
    (muni?.settings as { timezone?: string } | undefined)?.timezone ??
    DEFAULT_TIMEZONE;
  const units = await unitConflictSet(input.unitId);
  const dates = weekdaysInRange(
    input.validFrom,
    input.validTo,
    input.weekday,
    tz,
  );
  if (dates.length === 0) {
    return {
      cancelledCount: 0,
      peopleCount: 0,
      matchCount: 0,
      bookingIds: [] as string[],
      bookedDates: [] as string[],
    };
  }
  const rows = await getDb()
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, municipalityId),
        inArray(t.bookings.unitId, [...units]),
        inArray(t.bookings.date, dates),
        inArray(t.bookings.status, ["confirmed", "pending"]),
      ),
    );
  const affected = rows.filter((b) =>
    timesOverlap(input.start, input.end, b.start, b.end),
  );
  const peopleCount = new Set(affected.map((b) => b.userId)).size;
  const bookedDates = [...new Set(affected.map((b) => b.date))].sort();
  return {
    cancelledCount: affected.length,
    peopleCount,
    matchCount: 0,
    bookingIds: affected.map((b) => b.id),
    bookedDates,
  };
}

export async function listFixedGroups(municipalityId: string) {
  const rows = await getDb()
    .select()
    .from(t.fixedGroups)
    .where(eq(t.fixedGroups.municipalityId, municipalityId));
  return rows.map(mapGroup);
}

export async function createFixedGroup(
  municipalityId: string,
  actor: string,
  input: {
    name: string;
    facilityId: string;
    unitId: string;
    weekday: number;
    start: string;
    end: string;
    validFrom: string;
    validTo: string;
    clubId?: string;
    confirm?: boolean;
  },
) {
  const fac = await getFacility(input.facilityId);
  if (!fac || fac.municipalityId !== municipalityId) throw new Error("not_found");
  const units = await listUnits(input.facilityId);
  if (!units.some((u) => u.id === input.unitId)) throw new Error("unit_not_found");
  if (input.weekday < 0 || input.weekday > 6) throw new Error("invalid_weekday");
  if (input.start >= input.end) throw new Error("invalid_range");
  if (input.validFrom > input.validTo) throw new Error("invalid_range");

  const impact = await previewFixedGroupImpact(municipalityId, input);
  if (impact.cancelledCount > 0 && !input.confirm) {
    return { needsConfirm: true as const, ...impact };
  }

  const id = nid("fg");
  const operationKey = `fixed-group:${id}`;
  const reason = `Grupo fixo «${input.name.trim()}»`;
  const affected =
    input.confirm && impact.bookingIds.length > 0
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
      const bFac = await getFacility(b.facilityId);
      const bUnits = await listUnits(b.facilityId);
      const unitName = bUnits.find((u) => u.id === b.unitId)?.name;
      return {
        bookingId: b.id,
        notice: {
        id: nid("n-fg"),
        municipalityId,
        userId: b.userId,
        noticeType: "closure" as const,
        notifyType: "cancelacion" as const,
        title: "Reserva cancelada por grupo fixo",
        body: `A túa reserva do ${formatDayChip(b.date, "gl")} · ${b.start}–${b.end} foi cancelada: ${reason}`,
        email: {
          kind: "facility_closure" as const,
          data: {
            sport: bFac?.name ?? "Deporte",
            facilityName: bFac?.name ?? "Instalación",
            facilityId: b.facilityId,
            facilityAddress: bFac?.address,
            unitName,
            dayLabel: formatDayChip(b.date, "gl"),
            timeLabel: `${b.start}–${b.end}`,
            date: b.date,
            start: b.start,
            end: b.end,
            bookingId: b.id,
            icsSequence: b.icsSequence ?? 0,
            reason,
            alternatives: [],
          },
        },
        },
      };
      }),
  );

  const cancelledCount = await getDb().transaction(async (tx) => {
    await tx.insert(t.fixedGroups).values({
      id,
      municipalityId,
      facilityId: input.facilityId,
      unitId: input.unitId,
      name: input.name.trim(),
      weekday: input.weekday,
      start: input.start,
      end: input.end,
      validFrom: input.validFrom,
      validTo: input.validTo,
      clubId: input.clubId ?? null,
      createdBy: actor,
      active: true,
      createdAt: new Date(),
    });
    let cancelled = 0;
    for (const item of notices) {
      const changed = await tx
        .update(t.bookings)
        .set({ status: "cancelled", cancelReason: reason })
        .where(
          and(
            eq(t.bookings.id, item.bookingId),
            inArray(t.bookings.status, ["confirmed", "pending"]),
          ),
        )
        .returning();
      if (changed.length === 0) continue;
      cancelled += 1;
      await enqueueUserNotice(
        tx,
        `${operationKey}:booking:${item.bookingId}`,
        municipalityId,
        { operationKey, notice: item.notice },
      );
    }
    await tx.insert(t.auditEvents).values({
      id: nid("au"),
      municipalityId,
      at: new Date(),
      actor,
      action: "fixed_group.create",
      detail: `${input.name} (${id})`,
    });
    return cancelled;
  });
  /* Alternativas baleiras no TX; enrich post-commit (evita deadlock PGlite). */
  await enrichClosureOutboxAlternatives(operationKey);
  await drainNotificationOutboxSafely(operationKey);
  await regenerateFixedGroupUnits(municipalityId, input.unitId);
  const group = (await listFixedGroups(municipalityId)).find((g) => g.id === id)!;
  return {
    needsConfirm: false as const,
    ...group,
    cancelledCount,
    peopleCount: input.confirm ? impact.peopleCount : 0,
    matchCount: 0,
  };
}

export async function deactivateFixedGroup(
  municipalityId: string,
  id: string,
  actor: string,
) {
  const rows = await getDb()
    .select()
    .from(t.fixedGroups)
    .where(
      and(
        eq(t.fixedGroups.id, id),
        eq(t.fixedGroups.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error("not_found");
  await getDb().transaction(async (tx) => {
    await tx
      .update(t.fixedGroups)
      .set({ active: false })
      .where(eq(t.fixedGroups.id, id));
    await tx.insert(t.auditEvents).values({
      id: nid("au"),
      municipalityId,
      at: new Date(),
      actor,
      action: "fixed_group.deactivate",
      detail: id,
    });
  });
  await regenerateFixedGroupUnits(municipalityId, rows[0].unitId);
  return mapGroup({ ...rows[0], active: false });
}

function mapGroup(r: typeof t.fixedGroups.$inferSelect) {
  return {
    id: r.id,
    facilityId: r.facilityId,
    unitId: r.unitId,
    name: r.name,
    weekday: r.weekday,
    start: r.start,
    end: r.end,
    validFrom: r.validFrom,
    validTo: r.validTo,
    clubId: r.clubId,
    active: r.active,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}
