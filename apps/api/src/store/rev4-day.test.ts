/**
 * Rev4 erros 9–13 + día a día (recordatorios, Estou aquí, persoas, informe, incidencias).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev4d-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-rev4-day";
delete process.env.DATABASE_URL;
delete process.env.SMTP_HOST;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
await initDb();
await migrateSchema();
await seedDb();

const {
  dailyDoorCode,
  markNoShow,
  monthlyReport,
  searchPeople,
  selfCheckIn,
} = await import("./rev4-ops.js");
const { setIncidentStatus, createIncident } = await import("./incidents.js");
const { listBookings, getMunicipalityBySlug } = await import("./db.js");
const { localDateIso, DEFAULT_TIMEZONE } = await import("./business-rules.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

describe("Rev4 day tranche", () => {
  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("format door code is stable per day/facility", () => {
    const a = dailyDoorCode("fac-x", "2026-10-24");
    const b = dailyDoorCode("fac-x", "2026-10-24");
    const c = dailyDoorCode("fac-x", "2026-10-25");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[A-F0-9]{8}$/);
  });

  it("searchPeople encontra Ana por nome", async () => {
    const muni = await getMunicipalityBySlug("exemplo");
    assert.ok(muni);
    const rows = await searchPeople(muni.id, "Ana");
    assert.ok(rows.length >= 1);
    assert.ok(rows.some((r) => /ana/i.test(r.displayName)));
  });

  it("searchPeople ignora termos < 2 chars", async () => {
    const muni = await getMunicipalityBySlug("exemplo");
    assert.ok(muni);
    assert.deepEqual(await searchPeople(muni.id, "A"), []);
    assert.deepEqual(await searchPeople(muni.id, " "), []);
  });

  it("monthlyReport devolve totais", async () => {
    const muni = await getMunicipalityBySlug("exemplo");
    assert.ok(muni);
    const now = new Date();
    const r = await monthlyReport(muni.id, now.getFullYear(), now.getMonth() + 1);
    assert.ok(typeof r.totals.bookings === "number");
    assert.ok(Array.isArray(r.byFacility));
  });

  it("incidencia open → in_progress → done + notice", async () => {
    const muni = await getMunicipalityBySlug("exemplo");
    assert.ok(muni);
    const users = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.municipalityId, muni.id))
      .limit(5);
    const citizen = users.find((u) => u.role === "citizen")!;
    const inc = await createIncident(
      muni.id,
      { id: citizen.id, displayName: citizen.displayName },
      { body: "Foco roto na pista de padel de proba" },
    );
    assert.equal(inc?.status, "open");

    const mid = await setIncidentStatus(muni.id, inc!.id, "in_progress", "admin");
    assert.equal(mid?.status, "in_progress");

    const done = await setIncidentStatus(muni.id, inc!.id, "done", "admin");
    assert.equal(done?.status, "done");

    const notices = await getDb()
      .select()
      .from(t.notices)
      .where(eq(t.notices.userId, citizen.id));
    assert.ok(notices.some((n) => /incidencia/i.test(n.title)));
  });

  it("non-presentado marca no_show", async () => {
    const muni = await getMunicipalityBySlug("exemplo");
    assert.ok(muni);
    const today = localDateIso(new Date(), muni.settings.timezone ?? DEFAULT_TIMEZONE);
    const bookings = (await listBookings({ municipalityId: muni.id })).filter(
      (b) => b.date === today && b.status === "confirmed",
    );
    if (bookings.length === 0) {
      assert.ok(true);
      return;
    }
    const marked = await markNoShow(muni.id, bookings[0]!.id, "admin-test");
    assert.equal(marked.status, "no_show");
  });

  it("selfCheckIn fóra de xanela → erro", async () => {
    const muni = await getMunicipalityBySlug("exemplo");
    assert.ok(muni);
    const bookings = (await listBookings({ municipalityId: muni.id })).filter(
      (b) => b.status === "confirmed",
    );
    if (!bookings[0]) return;
    const b = bookings[0];
    if (!b.userId) return;
    await assert.rejects(
      () => selfCheckIn(muni.id, b.userId!, b.id, new Date("2020-01-01T12:00:00Z")),
      /too_early|too_late|invalid/,
    );
  });
});
