import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-first-come-race-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { eq } = await import("drizzle-orm");
const { closeDb, getDb, initDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createActivityAdmin } = await import("./admin-ops.js");
const { addDaysIso, todayIso } = await import("./business-rules.js");
const { applyToActivity } = await import("./db.js");

describe("first-come activity capacity under concurrency", () => {
  const municipalityId = "muni-exemplo";
  let activityId = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    const activity = await createActivityAdmin(municipalityId, "test", {
      name: "Última praza concorrente",
      facilityId: "fac-exemplo-pav",
      days: "Luns",
      hours: "18:00–19:00",
      places: 1,
      ageMin: 18,
      ageMax: 99,
      method: "first_come",
      deadline: addDaysIso(todayIso(), 7),
    });
    assert.ok(activity);
    activityId = activity.id;
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("accepts exactly one of simultaneous applicants for one place", async () => {
    const applicants = Array.from({ length: 8 }, (_, index) => `race-user-${index}`);

    await Promise.all(
      applicants.map((userId) =>
        applyToActivity({ activityId, municipalityId, userId }),
      ),
    );

    const rows = await getDb()
      .select({ status: t.activityApplications.status })
      .from(t.activityApplications)
      .where(eq(t.activityApplications.activityId, activityId));
    assert.equal(rows.length, applicants.length);
    assert.equal(rows.filter((row) => row.status === "accepted").length, 1);
    assert.equal(rows.filter((row) => row.status === "waitlist").length, 7);
  });
});
