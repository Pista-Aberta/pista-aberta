/**
 * REVISION-42 Q9 — solape de reservas persoais no concello.
 * Reutiliza a mesma regra temporal que `schedule_conflict` dos partidos abertos.
 */
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";

/** Mesma regra que open-matches.schedule_conflict. */
export function overlapsSlot(
  aDate: string,
  aStart: string,
  aEnd: string,
  bDate: string,
  bStart: string,
  bEnd: string,
): boolean {
  if (aDate !== bDate) return false;
  return aStart < bEnd && bStart < aEnd;
}

export type OverlapHit = {
  bookingId: string;
  facilityId: string;
  facilityName: string;
  date: string;
  start: string;
  end: string;
};

export class OverlappingBookingError extends Error {
  readonly code = "overlapping_booking" as const;
  readonly facilityName: string;
  readonly start: string;
  readonly date: string;
  readonly end: string;
  readonly bookingId: string;

  constructor(hit: OverlapHit) {
    super("overlapping_booking");
    this.name = "OverlappingBookingError";
    this.facilityName = hit.facilityName;
    this.start = hit.start;
    this.date = hit.date;
    this.end = hit.end;
    this.bookingId = hit.bookingId;
  }
}

/**
 * Busca unha reserva persoal (sen «en nome de») confirmada/pendente que solape.
 * Non conta reservas do persoal nin as feitas para un membro da familia.
 */
export async function findPersonalOverlappingBooking(opts: {
  municipalityId: string;
  userId: string;
  date: string;
  start: string;
  end: string;
  /** Ao modificar, ignora a propia reserva. */
  excludeBookingId?: string;
  /** Transacción opcional (REVISION-43 R9). */
  db?: ReturnType<typeof getDb>;
}): Promise<OverlapHit | null> {
  const db = opts.db ?? getDb();
  const rows = await db
    .select({
      id: t.bookings.id,
      facilityId: t.bookings.facilityId,
      date: t.bookings.date,
      start: t.bookings.start,
      end: t.bookings.end,
      forMemberId: t.bookings.forMemberId,
      bookedByStaff: t.bookings.bookedByStaff,
    })
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, opts.municipalityId),
        eq(t.bookings.userId, opts.userId),
        inArray(t.bookings.status, ["confirmed", "pending"]),
        isNull(t.bookings.forMemberId),
      ),
    );

  for (const b of rows) {
    if (opts.excludeBookingId && b.id === opts.excludeBookingId) continue;
    /* Reservas feitas polo persoal non bloquean á persoa. */
    if (b.bookedByStaff) continue;
    if (
      !overlapsSlot(
        opts.date,
        opts.start,
        opts.end,
        b.date,
        b.start,
        b.end,
      )
    ) {
      continue;
    }
    const [fac] = await db
      .select({ name: t.facilities.name })
      .from(t.facilities)
      .where(eq(t.facilities.id, b.facilityId))
      .limit(1);
    return {
      bookingId: b.id,
      facilityId: b.facilityId,
      facilityName: fac?.name ?? b.facilityId,
      date: b.date,
      start: b.start,
      end: b.end,
    };
  }
  return null;
}

/**
 * Lanza `OverlappingBookingError` se a persoa xa ten reserva persoal a esa hora.
 * Excepcións: persoal (`skip`) ou reserva «en nome de» (`skip`).
 */
export async function assertNoPersonalOverlap(opts: {
  municipalityId: string;
  userId: string;
  date: string;
  start: string;
  end: string;
  excludeBookingId?: string;
  /** true = persoal ou «en nome de» outro membro. */
  skip?: boolean;
  db?: ReturnType<typeof getDb>;
}): Promise<void> {
  if (opts.skip) return;
  const hit = await findPersonalOverlappingBooking(opts);
  if (hit) throw new OverlappingBookingError(hit);
}

/** Entradas de lista de espera activas da persoa cuxa franxa solapa. */
export async function listOverlappingWaitlistEntries(opts: {
  municipalityId: string;
  userId: string;
  date: string;
  start: string;
  end: string;
  excludeEntryId?: string;
}): Promise<Array<typeof t.waitlistEntries.$inferSelect & { slotDate: string; slotStart: string; slotEnd: string }>> {
  const rows = await getDb()
    .select({
      entry: t.waitlistEntries,
      slotDate: t.timeSlots.date,
      slotStart: t.timeSlots.start,
      slotEnd: t.timeSlots.end,
    })
    .from(t.waitlistEntries)
    .innerJoin(t.timeSlots, eq(t.waitlistEntries.slotId, t.timeSlots.id))
    .where(
      and(
        eq(t.waitlistEntries.municipalityId, opts.municipalityId),
        eq(t.waitlistEntries.userId, opts.userId),
        inArray(t.waitlistEntries.status, ["waiting", "offered"]),
        opts.excludeEntryId
          ? ne(t.waitlistEntries.id, opts.excludeEntryId)
          : undefined,
      ),
    );

  return rows
    .filter((r) =>
      overlapsSlot(
        opts.date,
        opts.start,
        opts.end,
        r.slotDate,
        r.slotStart,
        r.slotEnd,
      ),
    )
    .map((r) => ({
      ...r.entry,
      slotDate: r.slotDate,
      slotStart: r.slotStart,
      slotEnd: r.slotEnd,
    }));
}
