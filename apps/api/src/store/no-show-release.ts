/**
 * REVISION-24 T12 + REVISION-25 N2 — liberar reservas sen check-in tras `noShowReleaseMinutes`.
 * Só instalacións con check-in obrigatorio e reservas de hoxe (zona do concello).
 * Marca no-show sen penalización (vía `markNoShow` con `penalize: false`).
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { DEFAULT_TIMEZONE, localDateIso, slotInstant } from "./business-rules.js";
import { markNoShow } from "./rev4-ops.js";

export async function releaseNoShowBookings(
  now: Date = new Date(),
): Promise<number> {
  const db = getDb();
  const munis = await db.select().from(t.municipalities);
  let released = 0;
  for (const m of munis) {
    const settings = (m.settings ?? {}) as {
      noShowReleaseMinutes?: number;
      timezone?: string;
    };
    const releaseMin = settings.noShowReleaseMinutes ?? 30;
    if (releaseMin <= 0) continue;
    const tz = settings.timezone ?? DEFAULT_TIMEZONE;
    const today = localDateIso(now, tz);

    const requiredFacilities = await db
      .select({ id: t.facilities.id })
      .from(t.facilities)
      .where(
        and(
          eq(t.facilities.municipalityId, m.id),
          eq(t.facilities.checkInRequired, true),
        ),
      );
    if (requiredFacilities.length === 0) continue;
    const facIds = requiredFacilities.map((f) => f.id);

    const bookings = await db
      .select()
      .from(t.bookings)
      .where(
        and(
          eq(t.bookings.municipalityId, m.id),
          eq(t.bookings.date, today),
          eq(t.bookings.status, "confirmed"),
          inArray(t.bookings.facilityId, facIds),
        ),
      );

    for (const b of bookings) {
      const start = slotInstant(b.date, b.start, tz);
      const deadline = start.getTime() + releaseMin * 60_000;
      if (now.getTime() < deadline) continue;
      try {
        await markNoShow(m.id, b.id, "system:no-show-release", {
          penalize: false,
        });
        released += 1;
      } catch (e) {
        console.warn(
          `[jobs] no-show-release ${b.id}:`,
          (e as Error).message,
        );
      }
    }
  }
  return released;
}
