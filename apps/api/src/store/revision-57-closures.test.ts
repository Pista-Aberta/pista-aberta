/**
 * REVISION-57 J1/J2 — editar/borrar peche rexenera franxas; data-só normaliza.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev57-cl-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-revision-57-closures";
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
const { normalizeClosureBound } = await import("./business-rules.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);
const t = await import("../db/schema.js");

describe("REVISION-57 J1/J2 closures", () => {
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

  it("J2: data-só → T00:00 / T23:59; formato raro → erro", () => {
    const n = normalizeClosureBound("2026-11-15", "2026-11-15");
    assert.equal(n.startsAt, "2026-11-15T00:00");
    assert.equal(n.endsAt, "2026-11-15T23:59");
    assert.throws(
      () => normalizeClosureBound("15/11/2026", "2026-11-15T18:00"),
      /invalid_closure_datetime/,
    );
  });

  it("J2: create con data-só pecha o día enteiro", async () => {
    const r = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      startsAt: dayA,
      endsAt: dayA,
      reason: "Festivo J2",
      confirm: true,
      mode: "cancel_notify",
    });
    assert.equal(r.needsConfirm, false);
    if (r.needsConfirm) throw new Error("unexpected needsConfirm");
    const closureId = r.id;
    assert.ok(closureId);
    const row = (
      await getDb()
        .select()
        .from(t.closures)
        .where(eq(t.closures.id, closureId))
        .limit(1)
    )[0];
    assert.equal(row?.startsAt, `${dayA}T00:00`);
    assert.equal(row?.endsAt, `${dayA}T23:59`);
    const slot = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, dayA),
            eq(t.timeSlots.start, "10:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(slot?.closed, true);
    await deleteClosureAdmin(mid, closureId, "test");
  });

  it("J1: editar peche pecha o novo rango e reabre o vello", async () => {
    const created = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      startsAt: `${dayA}T18:00`,
      endsAt: `${dayA}T19:00`,
      reason: "Mantemento",
      confirm: true,
    });
    if (created.needsConfirm) throw new Error("unexpected needsConfirm");
    const createdId = created.id;
    assert.ok(createdId);
    const oldSlot = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, dayA),
            eq(t.timeSlots.start, "18:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(oldSlot?.closed, true);

    const updated = await updateClosureAdmin(mid, createdId, "test", {
      startsAt: `${dayB}T10:00`,
      endsAt: `${dayB}T12:00`,
      reason: "Mantemento movido",
      confirm: true,
      mode: "cancel_notify",
    });
    assert.equal(
      "needsConfirm" in updated && updated.needsConfirm ? true : false,
      false,
    );

    const reopened = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, dayA),
            eq(t.timeSlots.start, "18:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(reopened?.closed, false);

    const newClosed = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, dayB),
            eq(t.timeSlots.start, "10:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(newClosed?.closed, true);

    await deleteClosureAdmin(mid, createdId, "test");
    const afterDelete = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, dayB),
            eq(t.timeSlots.start, "10:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(afterDelete?.closed, false);
  });
});
