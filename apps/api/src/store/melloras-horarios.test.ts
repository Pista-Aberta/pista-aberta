/**
 * Horarios: multi-tramo por día e validación de solapes.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-horarios-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  upsertOpeningHours,
  listOpeningHours,
  validateOpeningHoursNoOverlap,
} = await import("./admin-ops.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

describe("melloras horarios multi-tramo", () => {
  const mid = "muni-exemplo";
  const unitId = "unit-padel-1";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    // Liberar slots seed para que regenerateSlotsForUnit non choque no índice único
    /* REVISION-40: partidos demo ligan reservas → borrar antes das franxas. */
    await getDb()
      .delete(t.bookings)
      .where(eq(t.bookings.unitId, unitId));
    await getDb().delete(t.timeSlots).where(eq(t.timeSlots.unitId, unitId));
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("upsert 2 tramos o mesmo día → GET 2", async () => {
    await upsertOpeningHours(mid, "test", {
      unitId,
      hours: [
        { weekday: 1, open: "09:00", close: "13:00" },
        { weekday: 1, open: "16:00", close: "21:00" },
      ],
    });
    const rows = await listOpeningHours(mid, unitId);
    const mon = rows.filter((h) => h.weekday === 1);
    assert.equal(mon.length, 2);
    assert.ok(mon.some((h) => h.open === "09:00" && h.close === "13:00"));
    assert.ok(mon.some((h) => h.open === "16:00" && h.close === "21:00"));
  });

  it("tramos solapados → hours_overlap", async () => {
    assert.throws(
      () =>
        validateOpeningHoursNoOverlap([
          { weekday: 2, open: "09:00", close: "14:00" },
          { weekday: 2, open: "13:00", close: "18:00" },
        ]),
      /hours_overlap/,
    );
    await assert.rejects(
      () =>
        upsertOpeningHours(mid, "test", {
          unitId,
          hours: [
            { weekday: 2, open: "09:00", close: "14:00" },
            { weekday: 2, open: "13:00", close: "18:00" },
          ],
        }),
      /hours_overlap/,
    );
  });

  it("horario especial persiste validFrom/validTo", async () => {
    await upsertOpeningHours(mid, "test", {
      unitId,
      hours: [
        { weekday: 1, open: "09:00", close: "13:00" },
        {
          weekday: 1,
          open: "10:00",
          close: "14:00",
          validFrom: "2099-07-01",
          validTo: "2099-07-31",
        },
      ],
    });
    const rows = await listOpeningHours(mid, unitId);
    const special = rows.filter((h) => h.validFrom === "2099-07-01");
    assert.equal(special.length, 1);
    assert.equal(special[0]!.validTo, "2099-07-31");
    assert.equal(special[0]!.open, "10:00");
    const weekly = rows.filter((h) => !h.validFrom && h.weekday === 1);
    assert.ok(weekly.some((h) => h.open === "09:00"));
  });
});
