/**
 * REVISION-57 J7/J4 — grupos fixos e season_slots dentro da campaña.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev57-bloq-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createFixedGroup, deactivateFixedGroup } = await import("./fixed-groups.js");
const { ensureSlotsAhead, regenerateSlotsForUnitAhead } = await import(
  "./slots-ahead.js"
);
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);
const { createSeason } = await import("./seasons.js");
const { newId } = await import("../lib/ids.js");

describe("REVISION-57 J7/J4 bloqueos", () => {
  const mid = "muni-exemplo";
  let monday: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 21 });
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    /* Seguinte luns (1). */
    let d = today;
    for (let i = 0; i < 14; i++) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow === 1 && d > today) {
        monday = d;
        break;
      }
      d = addDaysIso(d, 1);
    }
    assert.ok(monday);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("J7: grupo fixo pecha franxas; desactivar reabre", async () => {
    const g = await createFixedGroup(mid, "test", {
      name: "Grupo pádel luns",
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      weekday: 1,
      start: "10:00",
      end: "12:00",
      validFrom: monday,
      validTo: addDaysIso(monday, 28),
    });
    assert.equal(g.needsConfirm, false);
    if (g.needsConfirm) throw new Error("unexpected needsConfirm");
    const closed = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, monday),
            eq(t.timeSlots.start, "10:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(closed?.closed, true);
    assert.equal(closed?.closedReason, "grupo_fixo");

    await deactivateFixedGroup(mid, g.id, "test");
    const open = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, monday),
            eq(t.timeSlots.start, "10:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(open?.closed, false);
  });

  it("J4: season_slot só dentro de startsAt/endsAt da campaña", async () => {
    const club = (await getDb().select().from(t.clubs).limit(1))[0];
    assert.ok(club);
    const season = await createSeason({
      municipalityId: mid,
      name: "Tempada curta J4",
      startsAt: monday,
      endsAt: addDaysIso(monday, 7),
      facilityIds: ["fac-exemplo-padel"],
      criteriaGl: "",
      criteriaEs: "",
      published: true,
      actor: "test",
    });
    const slotId = newId("ss");
    await getDb().insert(t.seasonSlots).values({
      id: slotId,
      municipalityId: mid,
      clubId: club.id,
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      weekday: 1,
      start: "16:00",
      end: "17:00",
      priority: 1,
      seasonId: season.id,
    });
    await regenerateSlotsForUnitAhead(mid, "unit-padel-1", { days: 28 });

    const inside = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, monday),
            eq(t.timeSlots.start, "16:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(inside?.closed, true);

    const outsideDate = addDaysIso(monday, 14);
    /* Asegurar que fóra da campaña é luns. */
    assert.equal(new Date(`${outsideDate}T12:00:00Z`).getUTCDay(), 1);
    const outside = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, outsideDate),
            eq(t.timeSlots.start, "16:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(outside);
    assert.equal(outside.closed, false);

    /* Sen seasonId (tempada de club) segue bloqueando fóra de campaña. */
    const orphanId = newId("ss");
    await getDb().insert(t.seasonSlots).values({
      id: orphanId,
      municipalityId: mid,
      clubId: club.id,
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      weekday: 1,
      start: "17:00",
      end: "18:00",
      priority: 1,
      seasonId: null,
    });
    await regenerateSlotsForUnitAhead(mid, "unit-padel-1", { days: 28 });
    const orphanClosed = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, outsideDate),
            eq(t.timeSlots.start, "17:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(orphanClosed?.closed, true);
  });
});
