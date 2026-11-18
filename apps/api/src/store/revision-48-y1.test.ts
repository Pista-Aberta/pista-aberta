/**
 * REVISION-48 Y1 — partidos de club validan contra horario de apertura
 * (S–D 09–14 e 16–21), non só a ventá de reservas públicas.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r48-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { moveMatch } = await import("./admin-ops.js");
const {
  DEFAULT_TIMEZONE,
  futureWeekendSaturdayIso,
} = await import("./business-rules.js");

describe("REVISION-48 Y1 moveMatch apertura fin de semana", () => {
  const mid = "muni-exemplo";
  let matchId = "m5";
  let futureSat = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    futureSat = futureWeekendSaturdayIso(new Date(), DEFAULT_TIMEZONE);
    matchId = "m5";
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("mover a sábado 16:00–17:30 (apertura) → OK", async () => {
    const moved = await moveMatch(
      mid,
      matchId,
      {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-full",
        date: futureSat,
        start: "16:00",
        end: "17:30",
      },
      "test-admin",
    );
    assert.equal(moved.id, matchId);
    assert.equal(moved.status, "moved");
  });

  it("mover a sábado 03:00–04:00 → outside_hours", async () => {
    await assert.rejects(
      () =>
        moveMatch(
          mid,
          matchId,
          {
            facilityId: "fac-exemplo-pav",
            unitId: "unit-pav-full",
            date: futureSat,
            start: "03:00",
            end: "04:00",
          },
          "test-admin",
        ),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message, "outside_hours");
        return true;
      },
    );
  });
});
