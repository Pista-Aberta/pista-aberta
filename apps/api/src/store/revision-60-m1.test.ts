import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";
import { initDb, closeDb, getDb } from "../db/client.js";
import { migrateSchema } from "../db/migrate.js";
import { seedDb } from "../db/seed-db.js";
import * as t from "../db/schema.js";
import { createBooking, getBooking } from "./db.js";
import { dailyDoorCode, doorSelfCheckIn, selfCheckIn } from "./rev4-ops.js";
import { ensureSlotsAhead } from "./slots-ahead.js";
import { addDaysIso, DEFAULT_TIMEZONE, localDateIso, slotInstant } from "./business-rules.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev60-m1-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

describe("REVISION-60 M1 doorSelfCheckIn con checkInRequired", () => {
  const mid = "muni-exemplo";
  const facilityId = "fac-exemplo-padel";
  const userId = "user-cidada";
  let bookingId = "";
  let bookingDate = "";
  let bookingStart = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 7 });

    await getDb()
      .update(t.facilities)
      .set({ checkInRequired: true })
      .where(eq(t.facilities.id, facilityId));

    bookingDate = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 1);
    const slots = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.unitId, "unit-padel-1"),
          eq(t.timeSlots.date, bookingDate),
          eq(t.timeSlots.closed, false),
        ),
      );
    assert.ok(slots[0]);
    bookingStart = slots[0]!.start;

    const b = await createBooking({
      municipalityId: mid,
      slotId: slots[0]!.id,
      userId,
      userDisplayName: "Ana",
    });
    bookingId = b.id;
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("selfCheckIn normal segue rexeitando con door_checkin_required, pero doorSelfCheckIn marca checked_in", async () => {
    const now = slotInstant(bookingDate, bookingStart, DEFAULT_TIMEZONE);

    await assert.rejects(
      () => selfCheckIn(mid, userId, bookingId, now),
      /door_checkin_required/,
    );

    const code = dailyDoorCode(facilityId, bookingDate);
    const res = await doorSelfCheckIn(mid, userId, facilityId, code, bookingDate, now);
    assert.equal(res.state, "checked_in");
    if (res.state === "checked_in") {
      assert.equal(res.bookingId, bookingId);
    }

    const updated = await getBooking(bookingId);
    assert.equal(updated?.status, "checked_in");
  });
});
