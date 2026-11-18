import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-audit-p2-10-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { closeDb, getDb, initDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createFixedGroup } = await import("./fixed-groups.js");
const { createBooking } = await import("./db.js");
const { regenerateSlotsForUnitAhead } = await import("./slots-ahead.js");
const {
  drainNotificationOutbox,
  setNotificationOutboxFailureInjector,
} = await import("../notify/notification-outbox.js");
const {
  addDaysIso,
  DEFAULT_TIMEZONE,
  localDateIso,
  localWeekday,
} = await import("./business-rules.js");

describe("audit P2.10 transactional blocking notifications", () => {
  const municipalityId = "muni-exemplo";
  let firstTuesday: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    for (const unitId of ["unit-pav-full", "unit-pav-a", "unit-pav-b"]) {
      await regenerateSlotsForUnitAhead(municipalityId, unitId, { days: 35 });
    }
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    let date = addDaysIso(today, 1);
    while (localWeekday(date, DEFAULT_TIMEZONE) !== 2) {
      date = addDaysIso(date, 1);
    }
    firstTuesday = date;
  });

  after(async () => {
    setNotificationOutboxFailureInjector(undefined);
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("commits all cancellations when notice 2 fails, then retries once idempotently", async () => {
    const slots = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.unitId, "unit-pav-a"),
          eq(t.timeSlots.date, firstTuesday),
          inArray(t.timeSlots.start, ["16:00", "17:00"]),
          eq(t.timeSlots.closed, false),
        ),
      );
    assert.equal(slots.length, 2);
    const users = await getDb()
      .select()
      .from(t.users)
      .where(
        and(
          eq(t.users.municipalityId, municipalityId),
          eq(t.users.role, "citizen"),
          eq(t.users.active, true),
        ),
      )
      .limit(2);
    assert.equal(users.length, 2);

    const bookings = [];
    for (const [index, slot] of slots.entries()) {
      const user = users[index]!;
      bookings.push(
        await createBooking({
          municipalityId,
          slotId: slot.id,
          userId: user.id,
          userDisplayName: user.displayName,
        }),
      );
    }

    setNotificationOutboxFailureInjector((_payload, deliveryNumber) => {
      if (deliveryNumber === 2) throw new Error("injected_second_notice_failure");
    });
    const result = await createFixedGroup(municipalityId, "audit-p2.10", {
      name: "Grupo transaccional",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      weekday: 2,
      start: "16:00",
      end: "18:00",
      validFrom: firstTuesday,
      validTo: firstTuesday,
      confirm: true,
    });
    assert.equal(result.needsConfirm, false);
    assert.equal(result.cancelledCount, 2);

    const cancelled = await getDb()
      .select()
      .from(t.bookings)
      .where(inArray(t.bookings.id, bookings.map((booking) => booking.id)));
    assert.deepEqual(
      cancelled.map((booking) => booking.status).sort(),
      ["cancelled", "cancelled"],
    );
    assert.equal(
      (
        await getDb()
          .select()
          .from(t.notificationOutbox)
          .where(isNotNull(t.notificationOutbox.processedAt))
      ).length,
      1,
    );
    assert.equal(
      (
        await getDb()
          .select()
          .from(t.notificationOutbox)
          .where(isNull(t.notificationOutbox.processedAt))
      ).length,
      1,
    );

    setNotificationOutboxFailureInjector(undefined);
    assert.deepEqual(await drainNotificationOutbox(), {
      delivered: 1,
      failed: 0,
    });
    assert.deepEqual(await drainNotificationOutbox(), {
      delivered: 0,
      failed: 0,
    });

    const notices = await getDb()
      .select()
      .from(t.notices)
      .where(eq(t.notices.title, "Reserva cancelada por grupo fixo"));
    assert.equal(notices.length, 2);
    assert.equal((await getDb().select().from(t.fixedGroups)).length, 1);
  });
});
