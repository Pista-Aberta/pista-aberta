/**
 * P1 actividades: crear con sorteo (hash ao crear) e executar sorteo.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-act-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { eq } = await import("drizzle-orm");
const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { applyToActivity } = await import("./db.js");
const {
  createActivityAdmin,
  runLotteryAdmin,
  listActivityAdminDetail,
} = await import("./admin-ops.js");
const { hashSecret } = await import("./lottery.js");
const { addDaysIso, todayIso } = await import("./business-rules.js");

describe("melloras actividades P1", () => {
  const mid = "muni-exemplo";
  let actId = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    const act = await createActivityAdmin(mid, "test", {
      name: "Natación P1 test",
      description: "Proba CRUD",
      facilityId: "fac-exemplo-pav",
      days: "Martes",
      hours: "18:00–19:00",
      places: 1,
      ageMin: 6,
      ageMax: 14,
      method: "lottery",
      deadline: addDaysIso(todayIso(), 7),
    });
    assert.ok(act);
    actId = act!.id;
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("ao crear lottery publica hash e garda segredo (H6: API sen segredo)", async () => {
    const detail = await listActivityAdminDetail(mid, actId);
    assert.equal(detail.method, "lottery");
    assert.equal(detail.lotterySecret, null);
    assert.ok(detail.lotterySeedHash);
    assert.equal(detail.lotteryStatus, "open");
    const raw = (
      await getDb()
        .select()
        .from(t.activities)
        .where(eq(t.activities.id, actId))
        .limit(1)
    )[0];
    assert.ok(raw?.lotterySecret);
    assert.equal(hashSecret(raw.lotterySecret!), detail.lotterySeedHash);
  });

  it("sortear desde admin marca aceptadas", async () => {
    /* REVISION-52 C1b: ageMax < 18 esixe forMemberId (Carla ~10). */
    await applyToActivity({
      activityId: actId,
      municipalityId: mid,
      userId: "user-cidada",
      forMemberId: "fam-1",
    });
    const r = await runLotteryAdmin(mid, actId, "test-admin");
    assert.equal(r.accepted.length, 1);
    assert.equal(r.activity.lotteryStatus, "drawn");
  });
});
