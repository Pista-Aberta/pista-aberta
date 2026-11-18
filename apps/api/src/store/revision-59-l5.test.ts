/**
 * REVISION-59 L5 — migración valid_to en season_slots lexados.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev59-l5-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-revision-59-l5";
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");

describe("REVISION-59 L5 season_slots valid_to", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("L5: migrateSchema pon valid_to=30 xuño ás filas sen season_id nin valid_to", async () => {
    await getDb().insert(t.seasonSlots).values({
      id: "ss-legado-l5",
      municipalityId: "muni-exemplo",
      clubId: "club-basquet",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      weekday: 1,
      start: "07:00",
      end: "08:00",
      priority: 1,
      seasonId: null,
      validTo: null,
    });

    await migrateSchema();

    const row = (
      await getDb()
        .select()
        .from(t.seasonSlots)
        .where(eq(t.seasonSlots.id, "ss-legado-l5"))
        .limit(1)
    )[0];
    assert.ok(row);
    assert.equal(row.seasonId, null);
    assert.ok(row.validTo);
    assert.match(row.validTo!, /^\d{4}-06-30$/);

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const expected = m >= 7 ? `${y + 1}-06-30` : `${y}-06-30`;
    assert.equal(row.validTo, expected);

    /* Non toca as que xa teñen campaña ou data. */
    await getDb().insert(t.seasonSlots).values({
      id: "ss-con-campana-l5",
      municipalityId: "muni-exemplo",
      clubId: "club-basquet",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-a",
      weekday: 1,
      start: "07:00",
      end: "08:00",
      priority: 1,
      seasonId: "season-fake",
      validTo: null,
    });
    await getDb().insert(t.seasonSlots).values({
      id: "ss-con-data-l5",
      municipalityId: "muni-exemplo",
      clubId: "club-basquet",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-b",
      weekday: 1,
      start: "07:00",
      end: "08:00",
      priority: 1,
      seasonId: null,
      validTo: "2028-06-30",
    });
    await migrateSchema();
    const withSeason = (
      await getDb()
        .select()
        .from(t.seasonSlots)
        .where(eq(t.seasonSlots.id, "ss-con-campana-l5"))
        .limit(1)
    )[0];
    const withDate = (
      await getDb()
        .select()
        .from(t.seasonSlots)
        .where(eq(t.seasonSlots.id, "ss-con-data-l5"))
        .limit(1)
    )[0];
    assert.equal(withSeason?.validTo, null);
    assert.equal(withDate?.validTo, "2028-06-30");
  });
});
