/**
 * Preview + confirm CSV partidos contra seed Exemplo (PGlite).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import * as t from "../db/schema.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-csv-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { previewMatchCsv, confirmMatchCsv } = await import("./match-csv.js");

describe("melloras match CSV import", () => {
  const mid = "muni-exemplo";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("preview resolves clubs/teams and flags conflicts + unknown club", async () => {
    const csv = `date,start,home,away,club,category,unit
2030-03-15,18:00,CD Exemplo Senior,Visitante X,Club Deportivo Exemplo,senior,Pista completa
2030-03-15,18:15,Sarela Senior A,Rival Y,CV Sarela,senior,Pista completa
2030-03-15,20:00,Equipo Fantasma,Outro,Club Inventado,senior,Pista completa`;
    const prev = await previewMatchCsv(mid, csv);
    assert.equal(prev.okCount, 2);
    assert.equal(prev.errorCount, 1);
    assert.ok(prev.conflictCount >= 1);
    const bad = prev.rows.find((r) => !r.ok);
    assert.ok(bad?.errors.includes("unknown_club"));
  });

  it("confirm inserts valid rows", async () => {
    const csv = `date,start,home,away,club,category,unit
2030-04-12,17:00,CD Exemplo Senior,Visitante Import,Club Deportivo Exemplo,senior,Pista completa`;
    const result = await confirmMatchCsv(mid, "test-admin", csv);
    assert.equal(result.inserted, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.matchIds.length, 1);
  });

  it("Q1: preview and confirm reject explicit end <= start with bad_range", async () => {
    const csv = `date,start,end,home,away,club,category,unit
2030-05-10,19:00,18:00,CD Exemplo Senior,Visitante A,Club Deportivo Exemplo,senior,Pista completa
2030-05-10,18:00,18:00,CD Exemplo Senior,Visitante B,Club Deportivo Exemplo,senior,Pista completa`;
    const prev = await previewMatchCsv(mid, csv);
    assert.equal(prev.okCount, 0);
    assert.equal(prev.errorCount, 2);
    for (const row of prev.rows) {
      assert.equal(row.ok, false);
      assert.deepEqual(row.errors, ["bad_range"]);
    }

    const confirmed = await confirmMatchCsv(mid, "test-admin", csv);
    assert.equal(confirmed.inserted, 0);
    assert.equal(confirmed.skipped, 2);
  });

  it("Q1: preview and confirm reject category-computed end crossing midnight with bad_range", async () => {
    const csv = `date,start,home,away,club,category,unit
2030-05-11,23:00,CD Exemplo Senior,Visitante A,Club Deportivo Exemplo,senior,Pista completa
2030-05-11,23:00,Sarela Infantil,Visitante B,CV Sarela,infantil,Pista completa`;
    const prev = await previewMatchCsv(mid, csv);
    assert.equal(prev.okCount, 0);
    assert.equal(prev.errorCount, 2);
    assert.equal(prev.rows[0]?.end, "00:30");
    assert.deepEqual(prev.rows[0]?.errors, ["bad_range"]);
    assert.equal(prev.rows[1]?.end, "00:00");
    assert.deepEqual(prev.rows[1]?.errors, ["bad_range"]);

    const confirmed = await confirmMatchCsv(mid, "test-admin", csv);
    assert.equal(confirmed.inserted, 0);
    assert.equal(confirmed.skipped, 2);
  });

  it("Q2: exact club match beats partials, unique partial resolves, >1 partials gives ambiguous_club", async () => {
    const extraClubId = "club-ria-exemplo";
    await getDb().insert(t.clubs).values({
      id: extraClubId,
      municipalityId: mid,
      name: "CV Ría de Exemplo",
      shortName: "Ría de Exemplo",
    });

    try {
      const csv = `date,start,home,away,club,category,unit
2030-06-08,10:00,CD Exemplo Senior,Visitante 1,Exemplo,senior,Pista completa
2030-06-08,12:00,CD Exemplo Senior,Visitante 2,Club Deportivo Exemplo,senior,Pista completa
2030-06-08,16:00,Costa Senior,Visitante 3,Costa da Morte,senior,Pista completa`;
      const prev = await previewMatchCsv(mid, csv);
      assert.equal(prev.okCount, 2);
      assert.equal(prev.errorCount, 1);

      const [ambiguousRow, exactRow, singlePartialRow] = prev.rows;
      assert.equal(ambiguousRow?.ok, false);
      assert.equal(ambiguousRow?.clubId, undefined);
      assert.deepEqual(ambiguousRow?.errors, ["ambiguous_club"]);

      assert.equal(exactRow?.ok, true);
      assert.equal(exactRow?.clubId, "club-basquet");
      assert.deepEqual(exactRow?.errors, []);

      assert.equal(singlePartialRow?.ok, true);
      assert.equal(singlePartialRow?.clubId, "club-patin");
      assert.deepEqual(singlePartialRow?.errors, []);

      const confirmed = await confirmMatchCsv(mid, "test-admin", csv);
      assert.equal(confirmed.inserted, 2);
      assert.equal(confirmed.skipped, 1);
    } finally {
      await getDb().delete(t.clubs).where(eq(t.clubs.id, extraClubId));
    }
  });
});
