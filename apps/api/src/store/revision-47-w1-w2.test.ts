/**
 * REVISION-47 W1 — validación de horas ao mover/aprobar.
 * REVISION-47 W2 — semente sen solapes «Aprobado» incompatíbeis sen marcar.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r47-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { moveMatch, moveClubRequest, createClubRequest } = await import(
  "./admin-ops.js"
);
const { buildSeed, unmarkedApprovedOverlaps } = await import("./seed.js");
const {
  DEFAULT_TIMEZONE,
  addDaysIso,
  localDateIso,
  futureWeekendSaturdayIso,
} = await import("./business-rules.js");

describe("REVISION-47 W1 moveMatch timing", () => {
  const mid = "muni-exemplo";
  let matchId = "m5";
  let futureSat = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    futureSat = futureWeekendSaturdayIso(new Date(), DEFAULT_TIMEZONE);
    /* m5 está no sábado da fin de semana demo. */
    matchId = "m5";
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("end ≤ start → invalid_time", async () => {
    await assert.rejects(
      () =>
        moveMatch(
          mid,
          matchId,
          {
            facilityId: "fac-exemplo-pav",
            unitId: "unit-pav-full",
            date: futureSat,
            start: "12:00",
            end: "11:00",
          },
          "test-admin",
        ),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message, "invalid_time");
        return true;
      },
    );
  });

  it("franxa fóra do horario (03:00–04:00 S–D) → outside_hours", async () => {
    await assert.rejects(
      () =>
        moveMatch(
          mid,
          matchId,
          {
            facilityId: "fac-exemplo-pav",
            unitId: "unit-pav-full",
            date: futureSat,
            start: "03:00",
            end: "04:00",
          },
          "test-admin",
        ),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message, "outside_hours");
        return true;
      },
    );
  });

  it("data no pasado → in_past", async () => {
    /* Sábado 2025-01-04 · 10:00–11:00 (dentro do horario S–D 09–14). */
    await assert.rejects(
      () =>
        moveMatch(
          mid,
          matchId,
          {
            facilityId: "fac-exemplo-pav",
            unitId: "unit-pav-full",
            date: "2025-01-04",
            start: "10:00",
            end: "11:00",
          },
          "test-admin",
        ),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message, "in_past");
        return true;
      },
    );
  });

  it("mover solicitude match a horas inválidas → invalid_time", async () => {
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const date = addDaysIso(today, 14);
    /* Só S–D 09–14 no pavillón; coller un sábado futuro. */
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const sat = addDaysIso(date, dow === 6 ? 0 : (6 - dow + 7) % 7 || 7);
    const req = await createClubRequest({
      municipalityId: mid,
      clubId: "club-basquet",
      type: "match",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-a",
        date: sat,
        start: "09:00",
        end: "10:00",
        homeTeam: "Local",
        awayTeam: "Visitante",
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });
    await assert.rejects(
      () =>
        moveClubRequest(mid, req.id, "test-admin", {
          start: "12:00",
          end: "11:00",
        }),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message, "invalid_time");
        return true;
      },
    );
  });
});

describe("REVISION-47 W2 seed sen solapes aprobados", () => {
  it("ningún par «Aprobado» incompatíbel se pisa sen estar marcado", () => {
    const seed = buildSeed(new Date());
    const unmarked = unmarkedApprovedOverlaps(seed.matches, seed.units);
    assert.deepEqual(
      unmarked,
      [],
      `solapes sen marcar: ${JSON.stringify(unmarked)}`,
    );
  });

  it("notas do choque m2 sen «Choque con basquet»", () => {
    const seed = buildSeed(new Date());
    const m2 = seed.matches.find((m) => m.id === "m2");
    assert.ok(m2);
    assert.equal(m2!.notes, "Coincide con CD Exemplo Senior");
  });
});
