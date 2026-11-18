import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Booking } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import { mapBooking } from "../db/mappers.js";
import * as t from "../db/schema.js";

/** Operational exports are deliberately paged; full portability dumps are separate. */
export async function listBookingsForExport(opts: {
  municipalityId: string;
  dateFrom: string;
  dateTo: string;
  limit?: number;
  offset?: number;
}): Promise<Booking[]> {
  const limit = Math.min(1_000, Math.max(1, Math.trunc(opts.limit ?? 500)));
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  const rows = await getDb()
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, opts.municipalityId),
        gte(t.bookings.date, opts.dateFrom),
        lte(t.bookings.date, opts.dateTo),
      ),
    )
    .orderBy(asc(t.bookings.date), asc(t.bookings.start), asc(t.bookings.id))
    .limit(limit)
    .offset(offset);
  return rows.map(mapBooking);
}
