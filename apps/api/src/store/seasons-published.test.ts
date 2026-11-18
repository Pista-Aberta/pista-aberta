/**
 * REVISION-22 B4 — tempadas publicadas + RRULE.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-seasons-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-22-b4";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  createSeason,
  updateSeason,
  publishedSeasonsForFacility,
  seasonSlotRrule,
  weekdayToByDay,
} = await import("./seasons.js");

describe("REVISION-22 B4 tempadas publicadas", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("publicar unha tempada faina visible na ficha da instalación", async () => {
    const season = await createSeason({
      municipalityId: "muni-exemplo",
      name: "Tempada 2026-27",
      startsAt: "2026-09-01",
      endsAt: "2027-06-30",
      facilityIds: ["fac-exemplo-pav"],
      criteriaGl: "Clubs federados con prioridade",
      criteriaEs: "Clubs federados con prioridad",
      published: false,
      actor: "test-admin",
    });
    assert.equal(season.published, false);
    let pub = await publishedSeasonsForFacility("muni-exemplo", "fac-exemplo-pav");
    /* REVISION-46: a semente xa pode traer unha tempada publicada. */
    assert.equal(pub.filter((s) => s.id === season.id).length, 0);

    await updateSeason("muni-exemplo", season.id, {
      published: true,
      actor: "test-admin",
    });
    pub = await publishedSeasonsForFacility("muni-exemplo", "fac-exemplo-pav");
    const mine = pub.find((s) => s.id === season.id);
    assert.ok(mine);
    assert.equal(mine!.name, "Tempada 2026-27");
  });

  it("seasonSlotRrule xera RRULE semanal con UNTIL", () => {
    assert.equal(weekdayToByDay(3), "WE");
    const r = seasonSlotRrule({ weekday: 3, untilDate: "2027-06-30" });
    assert.match(r, /FREQ=WEEKLY/);
    assert.match(r, /BYDAY=WE/);
    assert.match(r, /UNTIL=20270630T215959Z/);
  });
});
