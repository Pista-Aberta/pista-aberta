/**
 * P1 normas: cambiar máximo de reservas e comprobar límite.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-normas-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBooking } = await import("./db.js");
const { putMunicipalityNormas, getNormas } = await import("./admin-ops.js");
const { addDaysIso, todayIso } = await import("./business-rules.js");
const t = await import("../db/schema.js");

describe("melloras normas P1", () => {
  const mid = "muni-exemplo";
  let freeSlotId = "";
  let freeSlotId2 = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await putMunicipalityNormas(mid, "test", {
      rules: { maxActiveBookings: 1, checkInMarginMinutes: 30 },
    });
    const date = addDaysIso(todayIso(), 3);
    freeSlotId = `slot-normas-a-${randomUUID().slice(0, 6)}`;
    freeSlotId2 = `slot-normas-b-${randomUUID().slice(0, 6)}`;
    await getDb().insert(t.timeSlots).values([
      {
        id: freeSlotId,
        unitId: "unit-padel-1",
        municipalityId: mid,
        date,
        start: "07:00",
        end: "08:00",
        closed: false,
        closedReason: null,
      },
      {
        id: freeSlotId2,
        unitId: "unit-padel-1",
        municipalityId: mid,
        date,
        /* REVISION-42 Q9: sen solape co primeiro (07:00–08:00) para chegar ao límite. */
        start: "08:00",
        end: "09:00",
        closed: false,
        closedReason: null,
      },
    ]);
  });

  after(async () => {
    await putMunicipalityNormas(mid, "test", {
      rules: { maxActiveBookings: 3, checkInMarginMinutes: 30 },
    });
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("GET normas reflicte maxActiveBookings=1 e marxe 30", async () => {
    const n = await getNormas(mid);
    assert.equal(n.rules.maxActiveBookings, 1);
    assert.equal(n.rules.checkInMarginMinutes, 30);
    assert.ok(n.rulesText.length >= 1);
  });

  it("segunda reserva dá booking_limit_exceeded", async () => {
    const userId = `u-normas-${randomUUID().slice(0, 6)}`;
    await createBooking({
      municipalityId: mid,
      slotId: freeSlotId,
      userId,
      userDisplayName: "Test Normas",
    });
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: mid,
          slotId: freeSlotId2,
          userId,
          userDisplayName: "Test Normas",
        }),
      /booking_limit_exceeded/,
    );
  });
});
