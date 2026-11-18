/**
 * REVISION-31 A1 — newId sen colisións: 200 audit() + cancelacións en bucle.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r31-a1-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-r31-a1";
process.env.PA_DEMO = "0";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { audit } = await import("./extra.js");
const { cancelBooking, listFacilities, listUnits } = await import("./db.js");
const { adminCancelBooking } = await import("./rev4-ops.js");
const { newId } = await import("../lib/ids.js");
const t = await import("../db/schema.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);

describe("REVISION-31 A1 ids", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("newId produce 200 ids distintos", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId("au")));
    assert.equal(ids.size, 200);
  });

  it("200 audit() seguidas sen duplicate key", async () => {
    const mid = "muni-exemplo";
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const ev = await audit(mid, "a1-test", "a1.burst", `n=${i}`);
      ids.push(ev.id);
    }
    assert.equal(new Set(ids).size, 200);
    const rows = await getDb()
      .select({ id: t.auditEvents.id })
      .from(t.auditEvents)
      .where(eq(t.auditEvents.action, "a1.burst"));
    assert.equal(rows.length, 200);
  });

  it("cancelBooking + avisos en bucle sen erro de id", async () => {
    const mid = "muni-exemplo";
    const facs = await listFacilities(mid);
    const fac = facs[0];
    assert.ok(fac);
    const units = await listUnits(fac.id);
    const unit = units[0];
    assert.ok(unit);

    const baseDay = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 8);
    const userId = `u-a1-${randomUUID().slice(0, 8)}`;
    await getDb().insert(t.users).values({
      id: userId,
      municipalityId: mid,
      role: "citizen",
      displayName: "A1 Cancel",
      email: `${userId}@test.local`,
      locale: "gl",
      active: true,
    });

    const bookingIds: string[] = [];
    for (let i = 0; i < 60; i++) {
      const day = addDaysIso(baseDay, Math.floor(i / 4));
      const slotId = newId("slot-a1");
      const bookingId = newId("bk-a1");
      const minute = (i % 4) * 15;
      const start = `06:${String(minute).padStart(2, "0")}`;
      const endMin = minute + 15;
      const end =
        endMin >= 60
          ? `07:${String(endMin - 60).padStart(2, "0")}`
          : `06:${String(endMin).padStart(2, "0")}`;
      await getDb().insert(t.timeSlots).values({
        id: slotId,
        municipalityId: mid,
        unitId: unit.id,
        date: day,
        start,
        end,
        closed: false,
      });
      await getDb().insert(t.bookings).values({
        id: bookingId,
        municipalityId: mid,
        facilityId: fac.id,
        unitId: unit.id,
        slotId,
        userId,
        userDisplayName: "A1 Cancel",
        date: day,
        start,
        end,
        status: "confirmed",
        shortCode: `A1${String(i).padStart(3, "0")}`,
        qrPayload: `qr-a1-${i}`,
      });
      bookingIds.push(bookingId);
    }

    for (let i = 0; i < 30; i++) {
      const cancelled = await cancelBooking(bookingIds[i]!, userId, true);
      assert.equal(cancelled.status, "cancelled");
    }
    for (let i = 30; i < 60; i++) {
      await adminCancelBooking(
        mid,
        bookingIds[i]!,
        { id: "staff-a1", displayName: "Staff A1" },
        "Peche de proba A1",
      );
    }
  });
});
