/**
 * REVISION-21 Q3: penalización por non presentados.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-penalty-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBooking } = await import("./db.js");
const { putMunicipalityNormas } = await import("./admin-ops.js");
const { markNoShow, clearBookingBlock } = await import("./rev4-ops.js");
const { addDaysIso, todayIso } = await import("./business-rules.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

describe("REVISION-21 Q3 no-show penalty", () => {
  const mid = "muni-exemplo";
  const userId = `u-penalty-${randomUUID().slice(0, 6)}`;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await putMunicipalityNormas(mid, "test", {
      rules: { noShowPenaltyCount: 2, noShowPenaltyDays: 7 },
    });
    await getDb().insert(t.users).values({
      id: userId,
      municipalityId: mid,
      role: "citizen",
      displayName: "Persoa Penalty",
      email: `${userId}@test.local`,
      locale: "gl",
      active: true,
    });
  });

  after(async () => {
    await putMunicipalityNormas(mid, "test", {
      rules: { noShowPenaltyCount: 0, noShowPenaltyDays: 0 },
    });
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("tras 2 no-shows bloquea e createBooking falla", async () => {
    const date = addDaysIso(todayIso(), 4);
    const mk = async (start: string, end: string) => {
      const slotId = `slot-pen-${randomUUID().slice(0, 8)}`;
      await getDb().insert(t.timeSlots).values({
        id: slotId,
        unitId: "unit-padel-1",
        municipalityId: mid,
        date,
        start,
        end,
        closed: false,
        closedReason: null,
      });
      const b = await createBooking({
        municipalityId: mid,
        slotId,
        userId,
        userDisplayName: "Persoa Penalty",
        bookedByStaff: true,
      });
      return b.id;
    };
    /* REVISION-50 A1: sen solape na mesma unidade (06:00–07:00 e 07:00–08:00). */
    const b1 = await mk("06:00", "07:00");
    const b2 = await mk("07:00", "08:00");
    await markNoShow(mid, b1, "staff");
    const r2 = await markNoShow(mid, b2, "staff");
    assert.equal(r2.penaltyApplied, true);
    assert.ok(r2.blockedUntil);

    const user = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.id, userId))
      .limit(1);
    assert.ok(user[0]?.bookingBlockedUntil);

    const slotId = `slot-pen-block-${randomUUID().slice(0, 8)}`;
    await getDb().insert(t.timeSlots).values({
      id: slotId,
      unitId: "unit-padel-1",
      municipalityId: mid,
      date: addDaysIso(todayIso(), 5),
      start: "05:00",
      end: "06:00",
      closed: false,
      closedReason: null,
    });
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: mid,
          slotId,
          userId,
          userDisplayName: "Persoa Penalty",
        }),
      /booking_blocked/,
    );

    await clearBookingBlock(mid, userId, "admin");
    const after = await createBooking({
      municipalityId: mid,
      slotId,
      userId,
      userDisplayName: "Persoa Penalty",
    });
    assert.equal(after.status, "confirmed");
  });

  it("penalize false marca no_show sen bookingBlockedUntil", async () => {
    const date = addDaysIso(todayIso(), 6);
    const slotId = `slot-pen-np-${randomUUID().slice(0, 8)}`;
    await getDb().insert(t.timeSlots).values({
      id: slotId,
      unitId: "unit-padel-1",
      municipalityId: mid,
      date,
      start: "05:00",
      end: "06:00",
      closed: false,
      closedReason: null,
    });
    const b = await createBooking({
      municipalityId: mid,
      slotId,
      userId,
      userDisplayName: "Persoa Penalty",
      bookedByStaff: true,
    });
    const r = await markNoShow(mid, b.id, "staff", { penalize: false });
    assert.equal(r.status, "no_show");
    assert.equal(r.penaltyApplied, undefined);

    const row = await getDb()
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.id, b.id))
      .limit(1);
    assert.equal(row[0]?.status, "no_show");

    const user = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.id, userId))
      .limit(1);
    assert.equal(user[0]?.bookingBlockedUntil, null);
  });
});
