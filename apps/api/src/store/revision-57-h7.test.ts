/**
 * REVISION-56 H7 — «Estou aquí» bloqueado se checkInRequired.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev57-h7-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createBooking, listBookings } = await import("./db.js");
const { selfCheckIn } = await import("./rev4-ops.js");
const { ensureSlotsAhead } = await import("./slots-ahead.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE, slotInstant } = await import(
  "./business-rules.js"
);
const { and } = await import("drizzle-orm");

describe("REVISION-56 H7 selfCheckIn", () => {
  const mid = "muni-exemplo";
  let bookingId = "";
  let startIso = "";
  let endIso = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 7 });
    await getDb()
      .update(t.facilities)
      .set({ checkInRequired: true })
      .where(eq(t.facilities.id, "fac-exemplo-padel"));
    const day = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 1);
    const slots = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.unitId, "unit-padel-1"),
          eq(t.timeSlots.date, day),
          eq(t.timeSlots.closed, false),
        ),
      );
    assert.ok(slots[0]);
    const b = await createBooking({
      municipalityId: mid,
      slotId: slots[0]!.id,
      userId: "user-cidada",
      userDisplayName: "Ana",
    });
    bookingId = b.id;
    startIso = day;
    endIso = slots[0]!.end;
    void endIso;
    const start = slotInstant(day, slots[0]!.start, DEFAULT_TIMEZONE);
    startIso = start.toISOString();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("H7: checkInRequired → door_checkin_required mesmo na xanela", async () => {
    const b = (await listBookings({ municipalityId: mid, userId: "user-cidada" })).find(
      (x) => x.id === bookingId,
    );
    assert.ok(b);
    const now = slotInstant(b.date, b.start, DEFAULT_TIMEZONE);
    await assert.rejects(
      () => selfCheckIn(mid, "user-cidada", bookingId, now),
      /door_checkin_required/,
    );
  });
});
