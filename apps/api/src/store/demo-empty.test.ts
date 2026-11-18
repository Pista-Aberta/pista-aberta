import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { closeDb, getDb, initDb } from "../db/client.js";
import { migrateSchema } from "../db/migrate.js";
import * as t from "../db/schema.js";
import { seedDb } from "../db/seed-db.js";
import { isDemoEmptyMode } from "../env.js";
import {
  createMunicipality,
  listMunicipalities,
  listMunicipalitiesAll,
} from "./db.js";
import { resetDemoData } from "./demo-reset.js";
import {
  DEPUTACION_DEMO_ORG_ID,
  DEPUTACION_PLATFORM_MUNI_ID,
  getDeputacionOrganization,
} from "./deputacion-org.js";
import { runHourlyJobs } from "./jobs.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-demo-empty-"));

describe("Demo baleira (PA_DEMO_EMPTY=1)", () => {
  const prevDemo = process.env.PA_DEMO;
  const prevEmpty = process.env.PA_DEMO_EMPTY;
  const prevSnap = process.env.DEMO_SNAPSHOT_PATH;
  const prevPglite = process.env.PGLITE_DATA_DIR;
  const prevDbUrl = process.env.DATABASE_URL;
  const prevNodeEnv = process.env.NODE_ENV;

  before(async () => {
    process.env.PGLITE_DATA_DIR = tmpDir;
    process.env.PA_DEMO = "1";
    process.env.PA_DEMO_EMPTY = "1";
    process.env.NODE_ENV = "test";
    delete process.env.DEMO_SNAPSHOT_PATH;
    delete process.env.DATABASE_URL;
    await initDb();
    await migrateSchema();
  });

  after(async () => {
    await closeDb();
    if (prevDemo === undefined) delete process.env.PA_DEMO;
    else process.env.PA_DEMO = prevDemo;
    if (prevEmpty === undefined) delete process.env.PA_DEMO_EMPTY;
    else process.env.PA_DEMO_EMPTY = prevEmpty;
    if (prevSnap === undefined) delete process.env.DEMO_SNAPSHOT_PATH;
    else process.env.DEMO_SNAPSHOT_PATH = prevSnap;
    if (prevPglite === undefined) delete process.env.PGLITE_DATA_DIR;
    else process.env.PGLITE_DATA_DIR = prevPglite;
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDbUrl;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("isDemoEmptyMode require modo demo e PA_DEMO_EMPTY activo", () => {
    assert.equal(isDemoEmptyMode(), true);
    process.env.PA_DEMO_EMPTY = "0";
    assert.equal(isDemoEmptyMode(), false);
    process.env.PA_DEMO_EMPTY = "1";
    process.env.PA_DEMO = "0";
    process.env.NODE_ENV = "production";
    assert.equal(isDemoEmptyMode(), false);
    process.env.PA_DEMO = "1";
    process.env.NODE_ENV = "test";
    assert.equal(isDemoEmptyMode(), true);
  });

  it("seedDb con PA_DEMO_EMPTY=1 crea só plataforma, Deputación e superadmin", async () => {
    await seedDb();
    const db = getDb();

    const publicMunis = await listMunicipalities();
    assert.deepEqual(publicMunis, []);

    const allMunis = await db.select().from(t.municipalities);
    assert.equal(allMunis.length, 1);
    assert.equal(allMunis[0]?.id, DEPUTACION_PLATFORM_MUNI_ID);

    const org = await getDeputacionOrganization();
    assert.ok(org);
    assert.equal(org.id, DEPUTACION_DEMO_ORG_ID);

    const users = await db.select().from(t.users);
    assert.equal(users.length, 1);
    assert.equal(users[0]?.role, "superadmin");
    assert.equal(users[0]?.municipalityId, DEPUTACION_PLATFORM_MUNI_ID);
    assert.equal(users[0]?.organizationId, DEPUTACION_DEMO_ORG_ID);

    assert.equal((await db.select().from(t.clubs)).length, 0);
    assert.equal((await db.select().from(t.facilities)).length, 0);
    assert.equal((await db.select().from(t.bookings)).length, 0);
    assert.equal((await db.select().from(t.waitlistEntries)).length, 0);
  });

  it("permite dar de alta un concello manual sen semear datos de proba nin reservas automáticas", async () => {
    const created = await createMunicipality({
      name: "Concello de Ribeiramar",
      slug: "ribeiramar",
      accentColor: "#145A4B",
      sandbox: false,
    });
    assert.equal(created.slug, "ribeiramar");

    // Rearranque simulado: seedDb e jobs horarios non engaden concellos nin reservas da semente
    await seedDb();
    const jobSummary = await runHourlyJobs(new Date("2026-11-18T11:00:00.000Z"));
    assert.equal(jobSummary.demoBookingsEnsured, 0);

    const allNonPlatform = (await listMunicipalitiesAll()).filter(
      (m) => !m.settings.deputacionPlatform,
    );
    assert.deepEqual(
      allNonPlatform.map((m) => m.slug),
      ["ribeiramar"],
    );
    assert.equal((await getDb().select().from(t.bookings)).length, 0);
  });

  it("resetDemoData sen foto e con PA_DEMO_EMPTY=1 volve á demo baleira e sen PA_DEMO_EMPTY volve á semente", async () => {
    await resetDemoData("test-empty-reset");
    assert.deepEqual(await listMunicipalities(), []);
    assert.equal((await getDb().select().from(t.users)).length, 1);

    delete process.env.PA_DEMO_EMPTY;
    await resetDemoData("test-full-reset");
    const seededMunis = await listMunicipalities();
    assert.ok(seededMunis.length >= 2);
  });
});
