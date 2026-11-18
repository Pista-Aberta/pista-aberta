import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { buildPersonalCalendarIcs, type BookingIcsInput } from "../lib/booking-ics.js";
import { getFacility, listBookings } from "./db.js";

export async function getOrCreateCalendarFeedToken(userId: string): Promise<string> {
  const rows = await getDb().select().from(t.users).where(eq(t.users.id, userId)).limit(1);
  const existing = rows[0]?.calendarFeedToken;
  if (existing) return existing;
  const token = randomBytes(24).toString("base64url");
  await getDb().update(t.users).set({ calendarFeedToken: token }).where(eq(t.users.id, userId));
  return token;
}

export async function rotateCalendarFeedToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await getDb().update(t.users).set({ calendarFeedToken: token }).where(eq(t.users.id, userId));
  return token;
}

export async function findUserByCalendarToken(municipalityId: string, token: string) {
  const rows = await getDb()
    .select()
    .from(t.users)
    .where(and(eq(t.users.municipalityId, municipalityId), eq(t.users.calendarFeedToken, token)))
    .limit(1);
  return rows[0] ?? null;
}

export async function personalCalendarIcs(municipalityId: string, userId: string): Promise<string> {
  const bookings = await listBookings({ municipalityId, userId });
  const active = bookings.filter(
    (b) => b.status === "confirmed" || b.status === "checked_in",
  );
  const facilityNames = new Map<string, string>();
  const events: BookingIcsInput[] = await Promise.all(
    active.map(async (b) => {
      let name = facilityNames.get(b.facilityId);
      if (!name) {
        name = (await getFacility(b.facilityId))?.name ?? b.facilityId;
        facilityNames.set(b.facilityId, name);
      }
      return {
        id: b.id,
        facilityName: name,
        date: b.date,
        start: b.start,
        end: b.end,
        shortCode: b.shortCode,
        sequence: b.icsSequence ?? 0,
      };
    }),
  );
  const { listOpenMatchesForUser } = await import("./open-matches.js");
  const matches = await listOpenMatchesForUser(municipalityId, userId);
  for (const m of matches) {
    events.push({
      id: m.id,
      facilityName: m.facilityName ?? "Partido aberto",
      date: m.date,
      start: m.start,
      end: m.end,
      openMatchTitle: m.title,
      sequence: 0,
    });
  }
  events.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  return buildPersonalCalendarIcs(events);
}
