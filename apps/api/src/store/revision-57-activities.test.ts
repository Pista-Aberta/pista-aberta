/**
 * REVISION-57 W5 + REVISION-56 H5/H6 — prazo, ano de nacemento, segredo do sorteo.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev57-act-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-revision-57-act";
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { applyToActivity, getActivity } = await import("./db.js");
const {
  createActivityAdmin,
  listActivityAdminDetail,
  runLotteryAdmin,
} = await import("./admin-ops.js");
const { addFamilyMember } = await import("./extra.js");
const { addDaysIso, todayIso } = await import("./business-rules.js");

describe("REVISION-57 activities W5/H5/H6", () => {
  const mid = "muni-exemplo";
  let actPastDeadline = "";
  let actOpen = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    const past = await createActivityAdmin(mid, "test", {
      name: "Prazo pechado",
      facilityId: "fac-exemplo-pav",
      days: "Luns",
      hours: "17:00–18:00",
      places: 2,
      ageMin: 6,
      ageMax: 14,
      method: "lottery",
      deadline: addDaysIso(todayIso(), -2),
    });
    actPastDeadline = past!.id;
    const open = await createActivityAdmin(mid, "test", {
      name: "Aberto idades",
      facilityId: "fac-exemplo-pav",
      days: "Martes",
      hours: "17:00–18:00",
      places: 2,
      ageMin: 6,
      ageMax: 14,
      method: "lottery",
      deadline: addDaysIso(todayIso(), 14),
    });
    actOpen = open!.id;
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("H5: inscrición fóra de prazo → deadline_passed", async () => {
    await assert.rejects(
      () =>
        applyToActivity({
          activityId: actPastDeadline,
          municipalityId: mid,
          userId: "user-cidada",
          forMemberId: "fam-1",
        }),
      /deadline_passed/,
    );
  });

  it("W5: familiar sen ano coa actividade con idades → birth_year_required", async () => {
    const fam = await addFamilyMember({
      userId: "user-cidada",
      municipalityId: mid,
      displayName: "Sen Ano",
      relation: "fillo",
    });
    await assert.rejects(
      () =>
        applyToActivity({
          activityId: actOpen,
          municipalityId: mid,
          userId: "user-cidada",
          forMemberId: fam.id,
        }),
      /birth_year_required/,
    );
  });

  it("H6: admin non ve lotterySecret antes do sorteo; si despois", async () => {
    const before = await listActivityAdminDetail(mid, actOpen);
    assert.equal(before.lotteryStatus, "open");
    assert.equal(before.lotterySecret, null);
    const mapped = await getActivity(actOpen);
    assert.equal(mapped?.lotterySecret, null);

    const raw = (
      await getDb()
        .select()
        .from(t.activities)
        .where(eq(t.activities.id, actOpen))
        .limit(1)
    )[0];
    assert.ok(raw?.lotterySecret);

    await applyToActivity({
      activityId: actOpen,
      municipalityId: mid,
      userId: "user-cidada",
      forMemberId: "fam-1",
    });
    const drawn = await runLotteryAdmin(mid, actOpen, "test");
    assert.equal(drawn.activity.lotteryStatus, "drawn");
    assert.ok(drawn.activity.lotterySecret);
    const after = await listActivityAdminDetail(mid, actOpen);
    assert.ok(after.lotterySecret);
  });

  it("ageMin > ageMax → invalid_age_range", async () => {
    await assert.rejects(
      () =>
        createActivityAdmin(mid, "test", {
          name: "Idades invertidas",
          facilityId: "fac-exemplo-pav",
          days: "Mércores",
          hours: "10:00–11:00",
          places: 1,
          ageMin: 14,
          ageMax: 6,
          method: "first_come",
          deadline: addDaysIso(todayIso(), 7),
        }),
      /invalid_age_range/,
    );
  });
});
