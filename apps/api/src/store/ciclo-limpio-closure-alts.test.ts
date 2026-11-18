/**
 * Ciclo limpo: alternativas de peche post-commit no outbox.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-ciclo-alts-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { closeDb, getDb, initDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createBooking } = await import("./db.js");
const { regenerateSlotsForUnitAhead } = await import("./slots-ahead.js");
const {
  createClosureAdmin,
  closureAlternativesForBooking,
} = await import("./admin-ops.js");
const {
  addDaysIso,
  DEFAULT_TIMEZONE,
  localDateIso,
} = await import("./business-rules.js");
const {
  setNotificationOutboxFailureInjector,
  drainNotificationOutbox,
} = await import("../notify/notification-outbox.js");

describe("ciclo limpo: alternativas peche post-commit", () => {
  const mid = "muni-exemplo";
  let day: string;
  let bookingId: string;
  let slotId: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await regenerateSlotsForUnitAhead(mid, "unit-padel-1", { days: 14 });
    day = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 3);
    const slots = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.unitId, "unit-padel-1"),
          eq(t.timeSlots.date, day),
          eq(t.timeSlots.closed, false),
        ),
      )
      .limit(5);
    assert.ok(slots.length >= 1);
    const slot = slots[0]!;
    slotId = slot.id;
    const citizens = await getDb()
      .select()
      .from(t.users)
      .where(
        and(
          eq(t.users.municipalityId, mid),
          eq(t.users.role, "citizen"),
          eq(t.users.active, true),
        ),
      )
      .limit(1);
    const user = citizens[0]!;
    const booking = await createBooking({
      municipalityId: mid,
      slotId: slot.id,
      userId: user.id,
      userDisplayName: user.displayName,
    });
    bookingId = booking.id;
  });

  after(async () => {
    setNotificationOutboxFailureInjector(undefined);
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("closureAlternativesForBooking devolve até 3 opcións", async () => {
    const alts = await closureAlternativesForBooking({
      municipalityId: mid,
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      date: day,
      start: "09:00",
      slotId,
    });
    assert.ok(alts.length <= 3);
    for (const a of alts) {
      assert.ok(a.label.length > 0);
      assert.ok(a.slotId);
      assert.ok(a.date);
    }
  });

  it("createClosureAdmin enrich post-commit antes do drain", async () => {
    /* Fallar o drain na 1ª entrega para inspeccionar o payload enriquecido. */
    setNotificationOutboxFailureInjector((_payload, n) => {
      if (n === 1) throw new Error("inject_fail_inspect");
    });
    const r = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      startsAt: `${day}T00:00`,
      endsAt: `${day}T23:59`,
      reason: "obras ciclo limpo",
      notifyCitizens: true,
      confirm: true,
      mode: "cancel_notify",
      notifyReason: "obras",
    });
    assert.equal(r.needsConfirm, false);
    assert.ok((r.cancelledCount ?? 0) >= 1);
    assert.ok(r.bookingIds?.includes(bookingId));

    const pending = await getDb().select().from(t.notificationOutbox);
    const closureMail = pending.find((row) => {
      const p = row.payload as {
        notice?: { email?: { kind?: string; data?: { alternatives?: unknown[]; bookingId?: string } } };
      };
      return (
        p.notice?.email?.kind === "facility_closure" &&
        p.notice.email.data?.bookingId === bookingId
      );
    });
    assert.ok(closureMail, "debe quedar outbox facility_closure pendente");
    const alts = (
      closureMail!.payload as {
        notice: { email: { data: { alternatives: unknown[] } } };
      }
    ).notice.email.data.alternatives;
    assert.ok(Array.isArray(alts));
    /* Se hai franxas libres noutros días/horas, deben vir recheas. */
    if (alts.length > 0) {
      const first = alts[0] as { label: string };
      assert.ok(first.label.length > 0);
    }

    setNotificationOutboxFailureInjector(undefined);
    await drainNotificationOutbox();
  });
});
