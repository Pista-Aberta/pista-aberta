import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-audit-p2-races-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "audit-p2-races";

const { closeDb, getDb, getDbMode, initDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const {
  approvePendingBooking,
  applyToActivity,
  createBooking,
  modifyBooking,
  runLottery,
  setBookingApprovalAuditFailureInjector,
} = await import("./db.js");
const {
  createActivityAdmin,
  createClosureAdmin,
  putFacilityNormas,
} = await import("./admin-ops.js");
const {
  drainNotificationOutbox,
  setNotificationOutboxFailureInjector,
} = await import("../notify/notification-outbox.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);

const municipalityId = "muni-exemplo";
const facilityId = "fac-exemplo-padel";
const unitId = "unit-padel-1";
let sequence = 0;
const supportsParallelTx = () => getDbMode() === "postgres";

function futureDate(days: number): string {
  return addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), days);
}

async function slot(
  date: string,
  start: string,
  end: string,
): Promise<string> {
  const id = `audit-p2-slot-${++sequence}`;
  await getDb().insert(t.timeSlots).values({
    id,
    municipalityId,
    unitId,
    date,
    start,
    end,
    closed: false,
  });
  return id;
}

async function user(id: string): Promise<void> {
  await getDb()
    .insert(t.users)
    .values({
      id,
      municipalityId,
      role: "citizen",
      displayName: id,
      email: `${id}@example.test`,
    })
    .onConflictDoNothing();
}

before(async () => {
  await initDb();
  await migrateSchema();
  await seedDb();
});

after(async () => {
  setBookingApprovalAuditFailureInjector(undefined);
  setNotificationOutboxFailureInjector(undefined);
  await closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("audit P2.1 booking serialization", () => {
  it("closure leaves no active booking on a closed slot", async () => {
    const date = futureDate(2);
    await user("audit-closure-user");

    if (supportsParallelTx()) {
      const slotId = await slot(date, "02:00", "03:00");
      const [bookingResult, closureResult] = await Promise.allSettled([
        createBooking({
          municipalityId,
          slotId,
          userId: "audit-closure-user",
          userDisplayName: "Closure race",
          skipNotify: true,
        }),
        createClosureAdmin(municipalityId, "audit", {
          facilityId,
          startsAt: `${date}T00:00`,
          endsAt: `${date}T23:59`,
          reason: "Race regression",
          confirm: true,
          notifyCitizens: false,
        }),
      ]);
      assert.equal(closureResult.status, "fulfilled");
      if (bookingResult.status === "rejected") {
        assert.match(String(bookingResult.reason), /slot_closed/);
      }
      const active = await getDb()
        .select()
        .from(t.bookings)
        .where(
          and(
            eq(t.bookings.slotId, slotId),
            eq(t.bookings.status, "confirmed"),
          ),
        );
      assert.equal(active.length, 0);
      return;
    }

    /*
     * PGlite is single-connection: Promise.all of two long transactions
     * deadlocks. Cover both serial orders that the shared facility lock
     * enforces on Postgres.
     */
    const bookThenClose = await slot(date, "02:00", "03:00");
    await createBooking({
      municipalityId,
      slotId: bookThenClose,
      userId: "audit-closure-user",
      userDisplayName: "Closure race",
      skipNotify: true,
    });
    await createClosureAdmin(municipalityId, "audit", {
      facilityId,
      startsAt: `${date}T00:00`,
      endsAt: `${date}T23:59`,
      reason: "Race regression book-then-close",
      confirm: true,
      notifyCitizens: false,
    });
    const afterClose = await getDb()
      .select({ status: t.bookings.status })
      .from(t.bookings)
      .where(eq(t.bookings.slotId, bookThenClose));
    assert.equal(afterClose[0]?.status, "cancelled");

    const closeThenBook = await slot(date, "04:00", "05:00");
    await createClosureAdmin(municipalityId, "audit", {
      facilityId,
      startsAt: `${date}T00:00`,
      endsAt: `${date}T23:59`,
      reason: "Race regression close-then-book",
      confirm: true,
      notifyCitizens: false,
    });
    await assert.rejects(
      createBooking({
        municipalityId,
        slotId: closeThenBook,
        userId: "audit-closure-user",
        userDisplayName: "Closure race",
        skipNotify: true,
      }),
      /slot_closed/,
    );
  });

  it("two moves of one booking leave exactly one winner", async () => {
    const date = futureDate(3);
    await user("audit-modify-user");
    const source = await slot(date, "02:00", "03:00");
    const targetA = await slot(date, "04:00", "05:00");
    const targetB = await slot(date, "06:00", "07:00");
    const booking = await createBooking({
      municipalityId,
      slotId: source,
      userId: "audit-modify-user",
      userDisplayName: "Modify race",
      skipNotify: true,
    });

    if (supportsParallelTx()) {
      const results = await Promise.allSettled([
        modifyBooking({
          bookingId: booking.id,
          newSlotId: targetA,
          userId: "audit-modify-user",
        }),
        modifyBooking({
          bookingId: booking.id,
          newSlotId: targetB,
          userId: "audit-modify-user",
        }),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        results.filter((result) => result.status === "rejected").length,
        1,
      );
      return;
    }

    /*
     * En PGlite non hai carreiras reais de TX; comprobamos que o camiño con
     * lock de usuario permite mover en serie e deixa a reserva no destino.
     */
    const first = await modifyBooking({
      bookingId: booking.id,
      newSlotId: targetA,
      userId: "audit-modify-user",
    });
    assert.equal(first.booking.slotId, targetA);
    assert.equal(first.previousSlotId, source);
    const second = await modifyBooking({
      bookingId: booking.id,
      newSlotId: targetB,
      userId: "audit-modify-user",
    });
    assert.equal(second.booking.slotId, targetB);
    assert.equal(second.previousSlotId, targetA);
  });
});

describe("audit P2.2 pending approval", () => {
  async function pending(userId: string, day: number, hour: string) {
    await user(userId);
    const slotId = await slot(
      futureDate(day),
      hour,
      `${String(Number(hour.slice(0, 2)) + 1).padStart(2, "0")}:00`,
    );
    return createBooking({
      municipalityId,
      slotId,
      userId,
      userDisplayName: userId,
      userRole: "citizen",
      skipNotify: true,
    });
  }

  before(async () => {
    await putFacilityNormas(municipalityId, facilityId, "audit", {
      rulesOverride: {
        approvalRequired: true,
        maxActiveBookings: 20,
        maxHoursPerWeek: 20,
      },
    });
  });

  it("rejects approval when the pending slot has since closed", async () => {
    const booking = await pending("audit-approval-closed", 4, "02:00");
    await getDb()
      .update(t.timeSlots)
      .set({ closed: true, closedReason: "maintenance" })
      .where(eq(t.timeSlots.id, booking.slotId));
    await assert.rejects(
      approvePendingBooking(municipalityId, booking.id, "audit"),
      /slot_closed/,
    );
    const row = await getDb()
      .select({ status: t.bookings.status })
      .from(t.bookings)
      .where(eq(t.bookings.id, booking.id));
    assert.equal(row[0]?.status, "pending");
  });

  it("audit failure is visible and rolls back approval", async () => {
    const booking = await pending("audit-approval-audit-fail", 5, "02:00");
    setBookingApprovalAuditFailureInjector(() => {
      throw new Error("injected_audit_failure");
    });
    await assert.rejects(
      approvePendingBooking(municipalityId, booking.id, "audit"),
      /injected_audit_failure/,
    );
    setBookingApprovalAuditFailureInjector(undefined);
    const row = await getDb()
      .select({ status: t.bookings.status })
      .from(t.bookings)
      .where(eq(t.bookings.id, booking.id));
    assert.equal(row[0]?.status, "pending");
  });

  it("notification failure remains observable and retryable in the outbox", async () => {
    const booking = await pending("audit-approval-notice-fail", 6, "02:00");
    setNotificationOutboxFailureInjector(() => {
      throw new Error("injected_notice_failure");
    });
    const approved = await approvePendingBooking(
      municipalityId,
      booking.id,
      "audit",
    );
    assert.equal(approved.status, "confirmed");
    const failed = await getDb()
      .select()
      .from(t.notificationOutbox)
      .where(
        and(
          eq(t.notificationOutbox.dedupeKey, `booking-approve:${booking.id}`),
          isNull(t.notificationOutbox.processedAt),
        ),
      );
    assert.equal(failed[0]?.attempts, 1);
    assert.match(failed[0]?.lastError ?? "", /injected_notice_failure/);
    setNotificationOutboxFailureInjector(undefined);
    const retry = await drainNotificationOutbox(
      `booking-approve:${booking.id}`,
    );
    assert.equal(retry.delivered, 1);
  });
});

describe("audit P2.3 lottery atomicity", () => {
  it("lottery racing an application leaves no pending application outside the draw", async () => {
    const activity = await createActivityAdmin(municipalityId, "audit", {
      name: "Lottery race",
      facilityId,
      days: "Luns",
      hours: "18:00–19:00",
      places: 1,
      ageMin: 18,
      ageMax: 99,
      method: "lottery",
      deadline: futureDate(7),
    });
    assert.ok(activity);
    await applyToActivity({
      activityId: activity.id,
      municipalityId,
      userId: "lottery-existing",
    });

    if (supportsParallelTx()) {
      await Promise.allSettled([
        runLottery(activity.id, municipalityId),
        applyToActivity({
          activityId: activity.id,
          municipalityId,
          userId: "lottery-racing",
        }),
      ]);
    } else {
      await runLottery(activity.id, municipalityId);
      await assert.rejects(
        applyToActivity({
          activityId: activity.id,
          municipalityId,
          userId: "lottery-racing",
        }),
        /lottery_done|closed|deadline|not_open/,
      );
    }

    const pending = await getDb()
      .select()
      .from(t.activityApplications)
      .where(
        and(
          eq(t.activityApplications.activityId, activity.id),
          eq(t.activityApplications.status, "pending"),
        ),
      );
    assert.equal(pending.length, 0);
  });
});
