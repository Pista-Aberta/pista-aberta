/**
 * REVISION-58 K2 — grupo fixo con reservas: needsConfirm e cancelación.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev58-k2-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createFixedGroup } = await import("./fixed-groups.js");
const { ensureSlotsAhead, regenerateSlotsForUnitAhead } = await import(
  "./slots-ahead.js"
);
const { createBooking } = await import("./db.js");
const { addDaysIso, localDateIso, localWeekday, DEFAULT_TIMEZONE } =
  await import("./business-rules.js");

describe("REVISION-58 K2 impacto grupo fixo", () => {
  const mid = "muni-exemplo";
  let tuesday: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 21 });
    for (const uid of ["unit-pav-full", "unit-pav-a", "unit-pav-b"]) {
      await regenerateSlotsForUnitAhead(mid, uid, { days: 28 });
    }
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    let d = today;
    for (let i = 0; i < 14; i++) {
      if (localWeekday(d, DEFAULT_TIMEZONE) === 2 && d > today) {
        tuesday = d;
        break;
      }
      d = addDaysIso(d, 1);
    }
    assert.ok(tuesday);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("K2: sen confirm devolve needsConfirm; con confirm cancela e pecha", async () => {
    const slot = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-pav-a"),
            eq(t.timeSlots.date, tuesday),
            eq(t.timeSlots.start, "16:00"),
            eq(t.timeSlots.closed, false),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(slot, `franxa libre ${tuesday} 16:00 media A`);

    const booking = await createBooking({
      municipalityId: mid,
      slotId: slot.id,
      userId: "user-brais",
      userDisplayName: "Luis Demo",
    });

    const preview = await createFixedGroup(mid, "test", {
      name: "Grupo con choque",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      weekday: 2,
      start: "16:00",
      end: "17:00",
      validFrom: tuesday,
      validTo: addDaysIso(tuesday, 28),
    });
    assert.equal(preview.needsConfirm, true);
    if (!preview.needsConfirm) throw new Error("expected needsConfirm");
    assert.ok(preview.cancelledCount >= 1);
    assert.ok(preview.peopleCount >= 1);
    assert.ok(preview.bookingIds.includes(booking.id));

    /* Aínda non creado nin cancelado. */
    const still = (
      await getDb()
        .select()
        .from(t.bookings)
        .where(eq(t.bookings.id, booking.id))
        .limit(1)
    )[0];
    assert.notEqual(still?.status, "cancelled");
    const groupsBefore = await getDb()
      .select()
      .from(t.fixedGroups)
      .where(eq(t.fixedGroups.name, "Grupo con choque"));
    assert.equal(groupsBefore.length, 0);

    const created = await createFixedGroup(mid, "test", {
      name: "Grupo con choque",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      weekday: 2,
      start: "16:00",
      end: "17:00",
      validFrom: tuesday,
      validTo: addDaysIso(tuesday, 28),
      confirm: true,
    });
    assert.equal(created.needsConfirm, false);
    if (created.needsConfirm) throw new Error("unexpected needsConfirm");
    assert.ok(created.id);

    const cancelled = (
      await getDb()
        .select()
        .from(t.bookings)
        .where(eq(t.bookings.id, booking.id))
        .limit(1)
    )[0];
    assert.equal(cancelled?.status, "cancelled");

    const closedA = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-pav-a"),
            eq(t.timeSlots.date, tuesday),
            eq(t.timeSlots.start, "16:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(closedA?.closed, true);
  });
});
