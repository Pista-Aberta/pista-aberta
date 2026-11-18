/**
 * REVISION-20 H1: franxas rodantes para unidades activas.
 * REVISION-21 L4.4: días curtos nos tests para non minutos.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-slots-ahead-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  ensureSlotsAhead,
  regenerateSlotsForUnitAhead,
} = await import("./slots-ahead.js");
const { createClosureAdmin } = await import("./admin-ops.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);
const t = await import("../db/schema.js");
const { and, eq, gte, lte } = await import("drizzle-orm");

describe("REVISION-20 H1 ensureSlotsAhead", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    /* 2 días abonda para as asercións; evita regenerar 8 días × todas as unidades. */
    await ensureSlotsAhead(new Date(), { days: 2 });
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("pavillón de Exemplo ten franxas nos próximos días", async () => {
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const last = addDaysIso(today, 1);
    const rows = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.unitId, "unit-pav-a"),
          gte(t.timeSlots.date, today),
          lte(t.timeSlots.date, last),
        ),
      );
    assert.ok(rows.length > 0, "media A debe ter franxas");
    const free = rows.filter((r) => !r.closed);
    assert.ok(free.length > 0, "debe haber libres");
  });

  it("unidade sen tocar 20 días regenera con days curtos", async () => {
    const unitId = "unit-padel-1";
    const mid = "muni-exemplo";
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    await getDb()
      .delete(t.bookings)
      .where(
        and(eq(t.bookings.unitId, unitId), gte(t.bookings.date, today)),
      );
    await getDb()
      .delete(t.timeSlots)
      .where(
        and(eq(t.timeSlots.unitId, unitId), gte(t.timeSlots.date, today)),
      );
    await regenerateSlotsForUnitAhead(mid, unitId, { days: 1 });
    const after1 = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(eq(t.timeSlots.unitId, unitId), gte(t.timeSlots.date, today)),
      );
    assert.ok(after1.length > 0);

    await regenerateSlotsForUnitAhead(mid, unitId, { days: 3 });
    const last = addDaysIso(today, 2);
    const week = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.unitId, unitId),
          gte(t.timeSlots.date, today),
          lte(t.timeSlots.date, last),
        ),
      );
    assert.ok(week.length >= 6, `esperadas varias franxas, hai ${week.length}`);
  });

  it("peche bloquea franxas do día", async () => {
    const unitId = "unit-padel-2";
    const mid = "muni-exemplo";
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const day = addDaysIso(today, 1);
    await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      unitId,
      startsAt: `${day}T00:00:00`,
      endsAt: `${day}T23:59:59`,
      reason: "proba peche H1",
      notifyCitizens: false,
      confirm: true,
    });
    await regenerateSlotsForUnitAhead(mid, unitId, {
      days: 2,
      pruneOrphans: true,
    });
    const rows = await getDb()
      .select()
      .from(t.timeSlots)
      .where(and(eq(t.timeSlots.unitId, unitId), eq(t.timeSlots.date, day)));
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.closed), "todas pechadas polo peche");
  });

  it("partido aprobado bloquea franxa e incompatibles", async () => {
    /* REVISION-43 R1: en domingo a semente ten partidos do sábado (onte);
     * regenerateSlotsForUnitAhead só mira cara adiante → coller partido ≥ hoxe. */
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const matches = await getDb()
      .select()
      .from(t.matches)
      .where(eq(t.matches.status, "scheduled"));
    assert.ok(matches.length > 0, "semente con scheduled");
    const m =
      matches.find((row) => row.date >= today) ??
      matches.sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
    assert.ok(m, "partido scheduled");
    const daysAhead = Math.max(
      7,
      Math.ceil(
        (Date.parse(`${m.date}T12:00:00Z`) -
          Date.parse(`${today}T12:00:00Z`)) /
          86_400_000,
      ) + 1,
    );
    await regenerateSlotsForUnitAhead("muni-exemplo", m.unitId, {
      days: daysAhead,
    });
    const slots = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(eq(t.timeSlots.unitId, m.unitId), eq(t.timeSlots.date, m.date)),
      );
    const overlapping = slots.filter((s) => {
      const a = s.start;
      const b = s.end;
      return a < m.end && m.start < b;
    });
    assert.ok(overlapping.length > 0, "hai franxas no tramo do partido");
    assert.ok(
      overlapping.every((s) => s.closed && s.closedReason === "partido"),
      "franxas do partido pechadas",
    );
  });
});
