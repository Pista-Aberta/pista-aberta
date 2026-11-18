/**
 * Punto 2: actividade viva da demo baleira — idempotencia.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { like } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-demo-live-"));
const setupPath = path.join(tmp, "demo-setup.json");
const usersPath = path.join(tmp, "demo-users.json");

fs.writeFileSync(
  setupPath,
  JSON.stringify(
    [
      {
        name: "Concello de Exemplo",
        slug: "exemplo",
        ineCode: "32078",
        clubs: [{ name: "Club Deportivo Exemplo", shortName: "Club Deportivo Exemplo" }],
      },
      {
        name: "Concello de Concello Secundario",
        slug: "secundario",
        ineCode: "32078",
        clubs: [],
      },
    ],
    null,
    2,
  ),
  "utf8",
);

fs.writeFileSync(
  usersPath,
  JSON.stringify(
    [
      {
        nif: "10000001S",
        nombre: "Veciña",
        apellidos: "Castro Lires",
        email: "vecina.exemplo@demo.pistaaberta.com",
        role: "vecino",
        municipalitySlug: "exemplo",
      },
      {
        nif: "10000002Q",
        nombre: "Luis",
        apellidos: "Otero Boo",
        email: "vecino.secundario@demo.pistaaberta.com",
        role: "vecino",
        municipalitySlug: "secundario",
      },
      {
        nif: "10000008E",
        nombre: "Miguel",
        apellidos: "Pereira Sende",
        email: "club.exemplo@exemplo.invalid",
        role: "club",
        municipalitySlug: "exemplo",
        clubName: "Club Deportivo Exemplo",
      },
      {
        nif: "10000007K",
        nombre: "Iria",
        apellidos: "Souto Barreiro",
        email: "deputacion@demo.pistaaberta.com",
        role: "deputacion",
        municipalitySlug: null,
      },
    ],
    null,
    2,
  ),
  "utf8",
);

process.env.PGLITE_DATA_DIR = path.join(tmp, "pg");
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-demo-live-activity";
process.env.PA_DEMO = "1";
process.env.PA_DEMO_EMPTY = "1";
process.env.DEMO_SETUP_FILE = setupPath;
process.env.DEMO_USERS_FILE = usersPath;
delete process.env.DATABASE_URL;
delete process.env.DEMO_SNAPSHOT_PATH;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedEmptyDemoDb } = await import("../db/seed-db.js");
const { initDemoUsersFromEnv } = await import("../identity/demo-users-file.js");
const { initDemoSetupFromEnv } = await import("../identity/demo-setup-file.js");
const { applyDemoSetupFile } = await import(
  "../identity/demo-setup-provision.js"
);
const { ensureSlotsAhead } = await import("./slots-ahead.js");
const { ensureDemoLiveActivity } = await import("./demo-live-activity.js");
const t = await import("../db/schema.js");

describe("ensureDemoLiveActivity idempotencia", () => {
  const now = new Date("2026-11-18T12:00:00.000Z");

  before(async () => {
    await initDb();
    await migrateSchema();
    initDemoUsersFromEnv();
    initDemoSetupFromEnv();
    await seedEmptyDemoDb();
    await applyDemoSetupFile();
    await ensureSlotsAhead(now);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("primeira chamada crea actividade; a segunda non duplica", async () => {
    const first = await ensureDemoLiveActivity(now);
    assert.ok(first.bookingsCreated > 0, "debe crear reservas");
    assert.ok(first.openMatchesCreated >= 2, "un partido aberto por concello");
    assert.ok(first.activitiesCreated >= 2, "unha actividade por concello");
    assert.ok(first.incidentsCreated >= 1, "incidencia en Exemplo");
    assert.ok(first.seasonSlotsCreated >= 2, "dúas franxas de tempada");
    assert.ok(first.matchesCreated >= 1, "choque de partido Club Deportivo Exemplo");

    const bookingsAfterFirst = await getDb()
      .select({ id: t.bookings.id })
      .from(t.bookings)
      .where(like(t.bookings.id, "live-bk-%"));
    const matchesAfterFirst = await getDb()
      .select({ id: t.openMatches.id })
      .from(t.openMatches)
      .where(like(t.openMatches.id, "live-om-%"));

    const second = await ensureDemoLiveActivity(now);
    assert.equal(second.bookingsCreated, 0);
    assert.equal(second.openMatchesCreated, 0);
    assert.equal(second.activitiesCreated, 0);
    assert.equal(second.incidentsCreated, 0);
    assert.equal(second.seasonSlotsCreated, 0);
    assert.equal(second.matchesCreated, 0);

    const bookingsAfterSecond = await getDb()
      .select({ id: t.bookings.id })
      .from(t.bookings)
      .where(like(t.bookings.id, "live-bk-%"));
    const matchesAfterSecond = await getDb()
      .select({ id: t.openMatches.id })
      .from(t.openMatches)
      .where(like(t.openMatches.id, "live-om-%"));

    assert.equal(bookingsAfterSecond.length, bookingsAfterFirst.length);
    assert.equal(matchesAfterSecond.length, matchesAfterFirst.length);
  });
});
