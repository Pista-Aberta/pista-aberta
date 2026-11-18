/**
 * Punto 0: reseteo nocturno só con foto; resetDemoData sen foto + DEMO_SETUP_FILE.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-demo-nightly-"));
const setupPath = path.join(tmp, "demo-setup.json");
fs.writeFileSync(
  setupPath,
  JSON.stringify(
    [
      {
        name: "Concello de Riba Demo",
        slug: "riba-demo",
        ineCode: "15991",
        clubs: [],
      },
      {
        name: "Concello de Costa Demo",
        slug: "costa-demo",
        ineCode: "15992",
        clubs: [],
      },
    ],
    null,
    2,
  ),
  "utf8",
);

process.env.PGLITE_DATA_DIR = path.join(tmp, "pg");
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-demo-nightly-reset";
process.env.PA_DEMO = "1";
process.env.PA_DEMO_EMPTY = "1";
process.env.DEMO_SETUP_FILE = setupPath;
delete process.env.DATABASE_URL;
delete process.env.DEMO_SNAPSHOT_PATH;
delete process.env.DEMO_USERS_FILE;
delete process.env.DEMO_NIGHTLY_RESET;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedEmptyDemoDb } = await import("../db/seed-db.js");
const { initDemoSetupFromEnv } = await import("../identity/demo-setup-file.js");
const { applyDemoSetupFile } = await import(
  "../identity/demo-setup-provision.js"
);
const { createMunicipality, listMunicipalitiesAll } = await import("./db.js");
const { resetDemoData } = await import("./demo-reset.js");
const { runHourlyJobs } = await import("./jobs.js");
const { isDemoNightlyResetEnabled } = await import("../env.js");
const t = await import("../db/schema.js");

describe("Demo nightly reset + DEMO_SETUP_FILE no reset manual", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedEmptyDemoDb();
    initDemoSetupFromEnv();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("isDemoNightlyResetEnabled respect DEMO_NIGHTLY_RESET=0", () => {
    assert.equal(isDemoNightlyResetEnabled(), true);
    process.env.DEMO_NIGHTLY_RESET = "0";
    assert.equal(isDemoNightlyResetEnabled(), false);
    delete process.env.DEMO_NIGHTLY_RESET;
    assert.equal(isDemoNightlyResetEnabled(), true);
  });

  it("sen foto, o job das 04:00 non borra un concello creado a man", async () => {
    const created = await createMunicipality({
      name: "Concello de Ribeiramar",
      slug: "ribeiramar-noite",
      accentColor: "#145A4B",
      sandbox: false,
    });
    assert.equal(created.slug, "ribeiramar-noite");

    /* 04:15 Europe/Madrid en novembro = 03:15 UTC */
    const at4 = new Date("2026-11-18T03:15:00.000Z");
    await getDb().delete(t.meta).where(eq(t.meta.key, "demo_reset_day"));
    const summary = await runHourlyJobs(at4);
    assert.equal(summary.demoReset, false);

    const still = (await listMunicipalitiesAll()).find(
      (m) => m.slug === "ribeiramar-noite",
    );
    assert.ok(still, "o concello manual debe seguir tras as 04:00 sen foto");
  });

  it("resetDemoData sen foto deixa os concellos do DEMO_SETUP_FILE", async () => {
    await applyDemoSetupFile();
    const before = await listMunicipalitiesAll();
    assert.ok(before.some((m) => m.slug === "riba-demo"));
    assert.ok(before.some((m) => m.slug === "costa-demo"));

    const res = await resetDemoData("test-setup-reset");
    assert.equal(res.restoredFromSnapshot, false);

    const after = await listMunicipalitiesAll();
    const slugs = after.map((m) => m.slug).sort();
    assert.ok(slugs.includes("riba-demo"));
    assert.ok(slugs.includes("costa-demo"));
  });
});
