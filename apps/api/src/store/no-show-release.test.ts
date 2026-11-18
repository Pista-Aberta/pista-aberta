/**
 * REVISION-25 N2 — liberación automática sen check-in.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-release-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBooking } = await import("./db.js");
const { putMunicipalityNormas } = await import("./admin-ops.js");
const { releaseNoShowBookings } = await import("./no-show-release.js");
const { localDateIso, slotInstant, addDaysIso, todayIso } = await import(
  "./business-rules.js"
);
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

const mid = "muni-exemplo";
const facId = "fac-exemplo-padel";
const unitId = "unit-padel-1";
const tz = "Europe/Madrid";

let slotCounter = 0;

/** Reserva confirmada «de hoxe» cun inicio xa pasado respecto a `releaseNow`. */
async function mkPastTodayBooking(
  userId: string,
  releaseNow: Date,
  start: string,
  end: string,
): Promise<string> {
  slotCounter += 1;
  const today = localDateIso(releaseNow, tz);
  const futureDate = addDaysIso(todayIso(), 4 + (slotCounter % 3));
  const slotId = `slot-rel-${randomUUID().slice(0, 8)}`;
  const seedStart = `${String(4 + (slotCounter % 10)).padStart(2, "0")}:00`;
  const seedEnd = `${String(5 + (slotCounter % 10)).padStart(2, "0")}:00`;
  await getDb().insert(t.timeSlots).values({
    id: slotId,
    unitId,
    municipalityId: mid,
    date: futureDate,
    start: seedStart,
    end: seedEnd,
    closed: false,
    closedReason: null,
  });
  const b = await createBooking({
    municipalityId: mid,
    slotId,
    userId,
    userDisplayName: "Test Release",
    bookedByStaff: true,
  });
  await getDb()
    .update(t.bookings)
    .set({ date: today, start, end })
    .where(eq(t.bookings.id, b.id));
  return b.id;
}

describe("REVISION-25 N2 no-show release", () => {
  const userId = `u-release-${randomUUID().slice(0, 6)}`;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await putMunicipalityNormas(mid, "test", {
      rules: {
        noShowReleaseMinutes: 30,
        noShowPenaltyCount: 2,
        noShowPenaltyDays: 7,
      },
    });
    await getDb().insert(t.users).values({
      id: userId,
      municipalityId: mid,
      role: "citizen",
      displayName: "Release User",
      email: `${userId}@test.local`,
      locale: "gl",
      active: true,
    });
  });

  after(async () => {
    await putMunicipalityNormas(mid, "test", {
      rules: {
        noShowReleaseMinutes: 30,
        noShowPenaltyCount: 0,
        noShowPenaltyDays: 0,
      },
    });
    await getDb()
      .update(t.facilities)
      .set({ checkInRequired: false })
      .where(eq(t.facilities.id, facId));
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("sen checkInRequired non libera reservas", async () => {
    const now = new Date("2026-06-15T14:00:00+02:00");
    const bookingId = await mkPastTodayBooking(userId, now, "09:00", "10:00");
    const n = await releaseNoShowBookings(now);
    assert.equal(n, 0);
    const row = await getDb()
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.id, bookingId))
      .limit(1);
    assert.equal(row[0]?.status, "confirmed");
  });

  it("con checkInRequired libera hoxe pasado sen bloquear", async () => {
    await getDb()
      .update(t.facilities)
      .set({ checkInRequired: true })
      .where(eq(t.facilities.id, facId));

    const now = new Date("2026-06-16T14:00:00+02:00");
    const today = localDateIso(now, tz);
    const bookingId = await mkPastTodayBooking(userId, now, "09:00", "10:00");
    const start = slotInstant(today, "09:00", tz);
    assert.ok(now.getTime() >= start.getTime() + 30 * 60_000);

    const n = await releaseNoShowBookings(now);
    assert.ok(n >= 1);
    const row = await getDb()
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.id, bookingId))
      .limit(1);
    assert.equal(row[0]?.status, "no_show");

    const user = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.id, userId))
      .limit(1);
    assert.equal(user[0]?.bookingBlockedUntil, null);
  });

  it("ignora reservas doutros días", async () => {
    const now = new Date("2026-06-17T14:00:00+02:00");
    const today = localDateIso(now, tz);
    const yesterday = addDaysIso(today, -1);

    slotCounter += 1;
    const futureDate = addDaysIso(todayIso(), 5);
    const slotId = `slot-rel-y-${randomUUID().slice(0, 8)}`;
    await getDb().insert(t.timeSlots).values({
      id: slotId,
      unitId,
      municipalityId: mid,
      date: futureDate,
      start: "03:00",
      end: "04:00",
      closed: false,
      closedReason: null,
    });
    const b = await createBooking({
      municipalityId: mid,
      slotId,
      userId,
      userDisplayName: "Test Release",
      bookedByStaff: true,
    });
    const bookingId = b.id;
    await getDb()
      .update(t.bookings)
      .set({ date: yesterday, start: "09:00", end: "10:00" })
      .where(eq(t.bookings.id, bookingId));

    const n = await releaseNoShowBookings(now);
    assert.equal(n, 0);

    const after = await getDb()
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.id, bookingId))
      .limit(1);
    assert.equal(after[0]?.status, "confirmed");
  });
});
