/**
 * DEMO_SETUP_FILE: validación Zod + creación idempotente de concellos/clubs.
 * Slugs ficticios (sen nomes reais de concellos no test).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-demo-setup-"));
process.env.PGLITE_DATA_DIR = path.join(tmp, "pg");
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-demo-setup-file";
process.env.PA_DEMO = "1";
process.env.PA_DEMO_EMPTY = "1";
delete process.env.DATABASE_URL;
delete process.env.DEMO_USERS_FILE;

const setupJsonPath = path.join(tmp, "demo-setup-test.json");
process.env.DEMO_SETUP_FILE = setupJsonPath;

fs.writeFileSync(
  setupJsonPath,
  JSON.stringify(
    [
      {
        name: "Concello de Riba Demo",
        slug: "riba-demo",
        ineCode: "15991",
        clubs: [{ name: "Riba Demo FS", shortName: "Riba FS" }],
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

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedEmptyDemoDb } = await import("../db/seed-db.js");
const { initDemoSetupFromEnv, parseDemoSetupJson } = await import(
  "../identity/demo-setup-file.js"
);
const { applyDemoSetupFile } = await import(
  "../identity/demo-setup-provision.js"
);
const { getMunicipalityBySlug, listClubs } = await import("./db.js");
const t = await import("../db/schema.js");

describe("DEMO_SETUP_FILE: validación e semente idempotente", () => {
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

  it("rexeita JSON inválido", () => {
    assert.throws(
      () => parseDemoSetupJson("not-json"),
      /JSON mal formado/,
    );
    assert.throws(
      () =>
        parseDemoSetupJson(
          JSON.stringify([{ name: "X", slug: "BAD", ineCode: "1" }]),
        ),
      /Validación fallida/,
    );
  });

  it("crea concellos e clubs unha soa vez; o segundo arranque non duplica nin modifica", async () => {
    const first = await applyDemoSetupFile();
    assert.deepEqual(first.created.sort(), ["costa-demo", "riba-demo"]);
    assert.deepEqual(first.skipped, []);

    const riba = await getMunicipalityBySlug("riba-demo");
    const costa = await getMunicipalityBySlug("costa-demo");
    assert.ok(riba);
    assert.ok(costa);
    assert.equal(riba!.settings.portalPublished, true);
    assert.equal(costa!.settings.portalPublished, true);
    assert.equal(riba!.settings.sandbox, undefined);

    const ribaClubs = await listClubs(riba!.id);
    const costaClubs = await listClubs(costa!.id);
    assert.equal(ribaClubs.length, 1);
    assert.equal(ribaClubs[0]!.name, "Riba Demo FS");
    assert.equal(costaClubs.length, 0);

    const invites = await getDb()
      .select()
      .from(t.invitations)
      .where(eq(t.invitations.municipalityId, riba!.id));
    /* Sen DEMO_USERS_FILE non se crea convite co NIF de proba. */
    assert.equal(invites.length, 0);

    const facCount = (
      await getDb()
        .select()
        .from(t.facilities)
        .where(eq(t.facilities.municipalityId, riba!.id))
    ).length;
    assert.ok(facCount >= 1);

    const nameBefore = riba!.name;
    const clubIdBefore = ribaClubs[0]!.id;
    const facCountBefore = facCount;

    const second = await applyDemoSetupFile();
    assert.deepEqual(second.created, []);
    assert.deepEqual(second.skipped.sort(), ["costa-demo", "riba-demo"]);

    const riba2 = await getMunicipalityBySlug("riba-demo");
    assert.equal(riba2!.name, nameBefore);
    const clubs2 = await listClubs(riba2!.id);
    assert.equal(clubs2.length, 1);
    assert.equal(clubs2[0]!.id, clubIdBefore);
    const facCountAfter = (
      await getDb()
        .select()
        .from(t.facilities)
        .where(eq(t.facilities.municipalityId, riba2!.id))
    ).length;
    assert.equal(facCountAfter, facCountBefore);

    const all = await getDb().select().from(t.municipalities);
    const demoSlugs = all
      .map((m) => m.slug)
      .filter((s) => s === "riba-demo" || s === "costa-demo");
    assert.equal(demoSlugs.length, 2);
  });

  it("se o concello xa existe, engade clubs do ficheiro que falten sen tocar instalacións", async () => {
    const costa = await getMunicipalityBySlug("costa-demo");
    assert.ok(costa);
    const facBefore = (
      await getDb()
        .select()
        .from(t.facilities)
        .where(eq(t.facilities.municipalityId, costa!.id))
    ).length;

    const setupPath = process.env.DEMO_SETUP_FILE!;
    fs.writeFileSync(
      setupPath,
      JSON.stringify(
        [
          {
            name: "Concello de Riba Demo",
            slug: "riba-demo",
            ineCode: "15991",
            clubs: [{ name: "Riba Demo FS", shortName: "Riba FS" }],
          },
          {
            name: "Concello de Costa Demo",
            slug: "costa-demo",
            ineCode: "15992",
            clubs: [{ name: "Costa Demo Atlético", shortName: "Costa Atl" }],
          },
        ],
        null,
        2,
      ),
      "utf8",
    );
    initDemoSetupFromEnv();

    const res = await applyDemoSetupFile();
    assert.deepEqual(res.created, []);
    assert.ok(res.skipped.includes("costa-demo"));

    const clubs = await listClubs(costa!.id);
    assert.equal(clubs.length, 1);
    assert.equal(clubs[0]!.name, "Costa Demo Atlético");

    const facAfter = (
      await getDb()
        .select()
        .from(t.facilities)
        .where(eq(t.facilities.municipalityId, costa!.id))
    ).length;
    assert.equal(facAfter, facBefore);
  });
});
