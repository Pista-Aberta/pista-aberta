/**
 * REVISION-52 — C1b (idade titular) + X1 (festivos) + X3 (horas libres sen horario).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev52-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
delete process.env.AUTH_ELEVATED_SAML_ONLY;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { applyToActivity } = await import("./db.js");
const {
  listFreeHoursForMatch,
  GALICIA_HOLIDAYS_2026_2027,
} = await import("./admin-ops.js");
const { GALICIA_HOLIDAYS_2026_2027: sharedHolidays } = await import(
  "@pista-aberta/shared"
);
const {
  addDaysIso,
  localDateIso,
  localWeekday,
  DEFAULT_TIMEZONE,
} = await import("./business-rules.js");

const mid = "muni-exemplo";

describe("REVISION-52", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("X1: festivos Reis / Festa Nacional e lista única shared", () => {
    assert.equal(GALICIA_HOLIDAYS_2026_2027, sharedHolidays);
    const reyes = GALICIA_HOLIDAYS_2026_2027.filter((h) =>
      h.date.endsWith("-01-06"),
    );
    assert.ok(reyes.length >= 2);
    for (const h of reyes) {
      assert.equal(h.nameGl, "Reis");
    }
    const festa = GALICIA_HOLIDAYS_2026_2027.filter((h) =>
      h.date.endsWith("-10-12"),
    );
    assert.ok(festa.length >= 2);
    for (const h of festa) {
      assert.equal(h.nameGl, "Festa Nacional de España");
      assert.equal(h.nameEs, "Fiesta Nacional de España");
    }
  });

  it("C1b: sen forMemberId e ageMax < 18 → age_out_of_range", async () => {
    await getDb()
      .update(t.activities)
      .set({ lotteryStatus: "open", ageMin: 8, ageMax: 14 })
      .where(eq(t.activities.id, "act-basquet-escola"));
    await getDb()
      .delete(t.activityApplications)
      .where(
        and(
          eq(t.activityApplications.activityId, "act-basquet-escola"),
          eq(t.activityApplications.userId, "user-cidada"),
        ),
      );
    await assert.rejects(
      () =>
        applyToActivity({
          activityId: "act-basquet-escola",
          municipalityId: mid,
          userId: "user-cidada",
        }),
      /age_out_of_range/,
    );
  });

  it("X3: listFreeHoursForMatch sen horario → lista baleira", async () => {
    const unitId = "unit-ghost-r52";
    const matchId = "match-ghost-r52";
    await getDb()
      .insert(t.units)
      .values({
        id: unitId,
        facilityId: "fac-exemplo-pav",
        municipalityId: mid,
        name: "Unidade sen horario",
        incompatibleWith: [],
        bookingKind: "ambas",
        slotMinutes: 60,
        capacity: 4,
        active: true,
      })
      .onConflictDoNothing();
    await getDb()
      .delete(t.openingHours)
      .where(eq(t.openingHours.unitId, unitId));

    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const wd = localWeekday(today);
    const satOffset = wd === 6 ? 0 : wd === 0 ? -1 : -(wd + 1);
    const date = addDaysIso(today, satOffset);

    await getDb().delete(t.matches).where(eq(t.matches.id, matchId));
    await getDb().insert(t.matches).values({
      id: matchId,
      municipalityId: mid,
      facilityId: "fac-exemplo-pav",
      unitId,
      date,
      start: "10:00",
      end: "11:00",
      homeTeamId: "team-home-r52",
      awayTeamId: "team-away-r52",
      clubId: "club-basquet",
      status: "scheduled",
      conflictWith: [],
    });

    const free = await listFreeHoursForMatch(mid, matchId, {
      unitId,
      facilityId: "fac-exemplo-pav",
    });
    assert.deepEqual(free, []);
  });
});
