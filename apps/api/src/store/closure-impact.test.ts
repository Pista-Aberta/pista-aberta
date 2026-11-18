/**
 * REVISION-22 A5 — impacto de peche: persoas, partidos, modos.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-closure-a5-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-22-a5";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  previewClosureImpact,
  createClosureAdmin,
} = await import("./admin-ops.js");
const { ensureSlotsAhead } = await import("./slots-ahead.js");
const { createBooking } = await import("./db.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);
const t = await import("../db/schema.js");
const { and, eq } = await import("drizzle-orm");

describe("REVISION-22 A5 closure impact", () => {
  const mid = "muni-exemplo";
  let day: string;
  let bookingId: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 3 });
    day = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 1);
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
    assert.ok(slots[0], "precisa franxa libre");
    const b = await createBooking({
      municipalityId: mid,
      slotId: slots[0]!.id,
      userId: "user-cidada",
      userDisplayName: "Cidadá demo",
    });
    bookingId = b.id;
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("preview devolve persoas e partidos", async () => {
    const impact = await previewClosureImpact(mid, {
      facilityId: "fac-exemplo-padel",
      startsAt: `${day}T00:00`,
      endsAt: `${day}T23:59`,
    });
    assert.ok(impact.cancelledCount >= 1);
    assert.ok(impact.peopleCount >= 1);
    assert.ok(typeof impact.matchCount === "number");
    assert.ok(impact.bookingIds.includes(bookingId));
  });

  it("sen confirm devolve needsConfirm", async () => {
    const r = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      startsAt: `${day}T00:00`,
      endsAt: `${day}T23:59`,
      reason: "proba impacto",
      notifyCitizens: false,
    });
    assert.equal(r.needsConfirm, true);
    assert.ok((r.cancelledCount ?? 0) >= 1);
  });

  it("skip_booked_days non cancela a reserva", async () => {
    const r = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      startsAt: `${day}T00:00`,
      endsAt: `${day}T23:59`,
      reason: "só días libres",
      notifyCitizens: false,
      confirm: true,
      mode: "skip_booked_days",
    });
    assert.equal(r.needsConfirm, false);
    assert.equal(r.cancelledCount, 0);
    const b = (
      await getDb()
        .select()
        .from(t.bookings)
        .where(eq(t.bookings.id, bookingId))
        .limit(1)
    )[0];
    assert.ok(b);
    assert.notEqual(b!.status, "cancelled");
  });

  it("REVISION-23 R7: cancel_notify cancela partidos e avisa", async () => {
    const day2 = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 2);
    await getDb().insert(t.matches).values({
      id: "match-r23-closure",
      municipalityId: mid,
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      date: day2,
      start: "18:00",
      end: "19:00",
      homeTeamId: "t-b1",
      awayTeamId: "t-b2",
      clubId: "club-basquet",
      status: "scheduled",
      conflictWith: [],
      notes: null,
    });
    const r = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      startsAt: `${day2}T00:00`,
      endsAt: `${day2}T23:59`,
      reason: "obras R7",
      notifyCitizens: true,
      confirm: true,
      mode: "cancel_notify",
      notifyReason: "obras na pista",
    });
    assert.equal(r.needsConfirm, false);
    const m = (
      await getDb()
        .select()
        .from(t.matches)
        .where(eq(t.matches.id, "match-r23-closure"))
        .limit(1)
    )[0];
    assert.equal(m?.status, "cancelled");
    assert.match(String(m?.notes ?? ""), /Cancelado polo peche/);
  });
});
