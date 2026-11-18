/**
 * REVISION-50 A1 — unidades incompatibles (pista completa ↔ medias).
 */
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return (
    timeToMinutes(aStart) < timeToMinutes(bEnd) &&
    timeToMinutes(bStart) < timeToMinutes(aEnd)
  );
}

type QueryDb = ReturnType<typeof getDb>;

/** Unidade + as que declara incompatibles (e as que a declaran a ela). */
export async function unitConflictSet(
  unitId: string,
  db: QueryDb = getDb(),
): Promise<Set<string>> {
  const rows = await db.select().from(t.units).where(eq(t.units.id, unitId)).limit(1);
  const u = rows[0];
  const set = new Set<string>([unitId]);
  for (const id of u?.incompatibleWith ?? []) set.add(id);
  /* Bidireccional: quen me lista a min. */
  if (!u?.municipalityId) return set;
  const peers = await db
    .select({ id: t.units.id, incompatibleWith: t.units.incompatibleWith })
    .from(t.units)
    .where(eq(t.units.municipalityId, u.municipalityId));
  for (const p of peers) {
    if ((p.incompatibleWith ?? []).includes(unitId)) set.add(p.id);
  }
  return set;
}

export async function assertNoIncompatibleBookingOverlap(input: {
  municipalityId: string;
  unitId: string;
  date: string;
  start: string;
  end: string;
  excludeBookingId?: string;
  db?: QueryDb;
}): Promise<void> {
  const db = input.db ?? getDb();
  const units = await unitConflictSet(input.unitId, db);
  const unitIds = [...units];
  const rows = await db
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, input.municipalityId),
        inArray(t.bookings.unitId, unitIds),
        eq(t.bookings.date, input.date),
        notInArray(t.bookings.status, ["cancelled", "no_show"]),
        ...(input.excludeBookingId
          ? [ne(t.bookings.id, input.excludeBookingId)]
          : []),
      ),
    );
  for (const b of rows) {
    if (timesOverlap(input.start, input.end, b.start, b.end)) {
      throw new Error("slot_occupied");
    }
  }
}

type BookingLite = {
  slotId: string;
  unitId: string;
  date: string;
  start: string;
  end: string;
  status: string;
};

/** Marca ocupadas franxas que solapan cunha reserva nunha unidade incompatible. */
export function slotOccupiedByIncompatible(
  slot: { id: string; unitId: string; date: string; start: string; end: string },
  bookings: BookingLite[],
  incompatByUnit: Map<string, Set<string>>,
): boolean {
  for (const b of bookings) {
    if (b.status === "cancelled" || b.status === "no_show") continue;
    if (b.slotId === slot.id) return true;
    if (b.date !== slot.date) continue;
    const set = incompatByUnit.get(slot.unitId);
    if (!set?.has(b.unitId)) continue;
    if (timesOverlap(slot.start, slot.end, b.start, b.end)) return true;
  }
  return false;
}

/**
 * REVISION-56 H4 — Map por data+unidade: sen percorrer todas as reservas por franxa.
 */
export function slotOccupiedByIncompatibleMapped(
  slot: { id: string; unitId: string; date: string; start: string; end: string },
  bookingsByDateUnit: Map<string, BookingLite[]>,
  incompatByUnit: Map<string, Set<string>>,
): boolean {
  const set = incompatByUnit.get(slot.unitId);
  if (!set) return false;
  for (const unitId of set) {
    const list = bookingsByDateUnit.get(`${slot.date}|${unitId}`);
    if (!list) continue;
    for (const b of list) {
      if (b.status === "cancelled" || b.status === "no_show") continue;
      if (b.slotId === slot.id) return true;
      if (timesOverlap(slot.start, slot.end, b.start, b.end)) return true;
    }
  }
  return false;
}
