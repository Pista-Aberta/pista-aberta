/**
 * REVISION-59 L1 — editar peche con reservas e confirm envía aviso/correo.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev59-l1-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-revision-59-l1";
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  createClosureAdmin,
  updateClosureAdmin,
  deleteClosureAdmin,
} = await import("./admin-ops.js");
const { ensureSlotsAhead } = await import("./slots-ahead.js");
const { createBooking } = await import("./db.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);
const t = await import("../db/schema.js");

describe("REVISION-59 L1 updateClosureAdmin avisa", () => {
  const mid = "muni-exemplo";
  let dayA: string;
  let dayB: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 14 });
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    dayA = addDaysIso(today, 2);
    dayB = addDaysIso(today, 3);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("L1: editar peche con reserva e confirm crea aviso para o usuario", async () => {
    const created = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      startsAt: `${dayA}T18:00`,
      endsAt: `${dayA}T19:00`,
      reason: "Mantemento L1",
      confirm: true,
      notifyCitizens: true,
    });
    assert.equal(created.needsConfirm, false);
    if (created.needsConfirm) throw new Error("unexpected needsConfirm");
    const closureId = created.id;
    assert.ok(closureId);

    const slot = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, dayB),
            eq(t.timeSlots.start, "10:00"),
            eq(t.timeSlots.closed, false),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(slot, `franxa libre ${dayB} 10:00`);

    const booking = await createBooking({
      municipalityId: mid,
      slotId: slot.id,
      userId: "user-cidada",
      userDisplayName: "Cidadá demo",
    });

    const preview = await updateClosureAdmin(mid, closureId, "test", {
      startsAt: `${dayB}T00:00`,
      endsAt: `${dayB}T23:59`,
      reason: "Mantemento ampliado L1",
      mode: "cancel_notify",
    });
    assert.equal(
      "needsConfirm" in preview && preview.needsConfirm ? true : false,
      true,
    );

    const updated = await updateClosureAdmin(mid, closureId, "test", {
      startsAt: `${dayB}T00:00`,
      endsAt: `${dayB}T23:59`,
      reason: "Mantemento ampliado L1",
      confirm: true,
      mode: "cancel_notify",
      notifyReason: "obras na pista",
    });
    assert.equal(
      "needsConfirm" in updated && updated.needsConfirm ? true : false,
      false,
    );
    assert.ok(
      "cancelledCount" in updated && (updated.cancelledCount ?? 0) >= 1,
    );

    const cancelled = (
      await getDb()
        .select()
        .from(t.bookings)
        .where(eq(t.bookings.id, booking.id))
        .limit(1)
    )[0];
    assert.equal(cancelled?.status, "cancelled");

    const notices = await getDb()
      .select()
      .from(t.notices)
      .where(
        and(
          eq(t.notices.municipalityId, mid),
          eq(t.notices.userId, "user-cidada"),
          eq(t.notices.type, "closure"),
        ),
      );
    assert.ok(
      notices.some(
        (n) =>
          n.title === "Peche de instalación" &&
          n.body.includes("obras na pista"),
      ),
      "debe existir aviso de peche para o usuario",
    );

    await deleteClosureAdmin(mid, closureId, "test");
  });

  it("L1: notifyCitizens=false non crea aviso ao editar", async () => {
    const dayC = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 4);
    const created = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      startsAt: `${dayA}T08:00`,
      endsAt: `${dayA}T09:00`,
      reason: "Sen aviso",
      confirm: true,
      notifyCitizens: false,
    });
    if (created.needsConfirm) throw new Error("unexpected needsConfirm");
    const closureId = created.id;
    assert.ok(closureId);

    const slot = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, dayC),
            eq(t.timeSlots.start, "11:00"),
            eq(t.timeSlots.closed, false),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(slot);

    const booking = await createBooking({
      municipalityId: mid,
      slotId: slot.id,
      userId: "user-brais",
      userDisplayName: "Luis Demo",
    });

    const before = await getDb()
      .select()
      .from(t.notices)
      .where(
        and(
          eq(t.notices.userId, "user-brais"),
          eq(t.notices.type, "closure"),
        ),
      );

    await updateClosureAdmin(mid, closureId, "test", {
      startsAt: `${dayC}T00:00`,
      endsAt: `${dayC}T23:59`,
      reason: "Sen aviso ampliado",
      confirm: true,
      mode: "cancel_notify",
    });

    const cancelled = (
      await getDb()
        .select()
        .from(t.bookings)
        .where(eq(t.bookings.id, booking.id))
        .limit(1)
    )[0];
    assert.equal(cancelled?.status, "cancelled");

    const after = await getDb()
      .select()
      .from(t.notices)
      .where(
        and(
          eq(t.notices.userId, "user-brais"),
          eq(t.notices.type, "closure"),
        ),
      );
    assert.equal(after.length, before.length);

    await deleteClosureAdmin(mid, closureId, "test");
  });
});
