/**
 * REVISION-44 S1–S3 — franxas pasadas (start <= agora), displayName bans,
 * semente domingo 18:00, maxActive na tx, aside/folla móbil.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  assertDisplayNameForMatch,
  isValidDisplayName,
} from "@pista-aberta/shared";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r44-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBooking } = await import("./db.js");
const {
  DEFAULT_TIMEZONE,
  isSlotInPast,
  localDateIso,
  slotInstant,
} = await import("./business-rules.js");
const { buildSeed } = await import("./seed.js");
const t = await import("../db/schema.js");

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function madridAt(isoDate: string, hm: string): Date {
  return slotInstant(isoDate, hm, DEFAULT_TIMEZONE);
}

describe("REVISION-44 S1 franxas pasadas (start <= agora)", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("ás 12:30 a franxa 12:00–13:00 é pasada; ás 11:59 non", () => {
    const day = "2026-11-08";
    const nowPast = madridAt(day, "12:30");
    const nowBefore = madridAt(day, "11:59");
    assert.equal(isSlotInPast(day, "12:00", nowPast, DEFAULT_TIMEZONE), true);
    assert.equal(isSlotInPast(day, "12:00", nowBefore, DEFAULT_TIMEZONE), false);
    /* Exactamente ao comezo tamén é pasada (start <= agora). */
    assert.equal(
      isSlotInPast(day, "12:00", madridAt(day, "12:00"), DEFAULT_TIMEZONE),
      true,
    );
  });

  it("createBooking ás 12:30 cunha franxa 12:00–13:00 → slot_in_past", async () => {
    const day = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const existing = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.unitId, "unit-padel-1"),
          eq(t.timeSlots.municipalityId, "muni-exemplo"),
          eq(t.timeSlots.date, day),
          eq(t.timeSlots.start, "12:00"),
        ),
      )
      .limit(1);
    let slotId = existing[0]?.id;
    if (!slotId) {
      slotId = `slot-r44-past-${randomUUID().slice(0, 8)}`;
      await getDb().insert(t.timeSlots).values({
        id: slotId,
        unitId: "unit-padel-1",
        municipalityId: "muni-exemplo",
        date: day,
        start: "12:00",
        end: "13:00",
        closed: false,
        closedReason: null,
      });
    }
    const now = madridAt(day, "12:30");
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: "muni-exemplo",
          slotId,
          userId: "user-cidada",
          userDisplayName: "Ana Demo",
          now,
        }),
      /slot_in_past/,
    );
  });

  it("clasificación pública: pasada → pechada (non libre)", () => {
    const day = "2026-11-08";
    const now = madridAt(day, "12:30");
    const today = localDateIso(now, DEFAULT_TIMEZONE);
    assert.equal(today, day);
    const past =
      day < today ||
      (day === today && isSlotInPast(day, "12:00", now, DEFAULT_TIMEZONE));
    assert.equal(past, true);
    const status = past ? "closed" : "free";
    assert.equal(status, "closed");
  });
});

describe("REVISION-44 S3 displayName bans + semente + UI", () => {
  it("rexeita Concello / Ayuntamiento / Deputación / Admin / Pista Aberta", () => {
    for (const bad of [
      "Concello de Exemplo",
      "Ayuntamiento de Ames",
      "Deputación da Coruña",
      "Diputación de Pontevedra",
      "Admin",
      "Admin do portal",
      "Pista Aberta",
      "Equipo Pista Aberta",
    ]) {
      assert.equal(isValidDisplayName(bad), false, bad);
      assert.throws(
        () => assertDisplayNameForMatch(bad),
        /invalid_display_name/,
        bad,
      );
    }
    assert.equal(assertDisplayNameForMatch("Ana R."), "Ana R.");
    assert.equal(assertDisplayNameForMatch("María Ñ."), "María Ñ.");
  });

  it("semente: partido do pavillón o domingo ás 18:00", () => {
    const sun = madridAt("2026-11-08", "12:00");
    const seed = buildSeed(sun);
    const evening = seed.matches.filter(
      (m) =>
        m.facilityId === "fac-exemplo-pav" &&
        m.date === "2026-11-08" &&
        m.start === "18:00",
    );
    assert.ok(evening.length >= 1, "falta partido domingo 18:00");
  });

  it("MunicipalityPage: aside só en lg; folla reserva bottom:0; maxActive na tx", () => {
    const muni = fs.readFileSync(
      path.join(ROOT, "apps/web/src/pages/MunicipalityPage.tsx"),
      "utf8",
    );
    assert.match(muni, /lg:flex-\[1_1_320px\]/);
    assert.match(muni, /hidden[\s\S]*lg:flex/);
    assert.doesNotMatch(
      muni,
      /<aside className="flex min-w-0 flex-\[1_1_320px\]/,
    );

    const css = fs.readFileSync(
      path.join(ROOT, "apps/web/src/components/ui/ui.css"),
      "utf8",
    );
    assert.match(css, /pa-reserve-sheet-open[\s\S]*bottom:\s*0/);
    assert.match(css, /safe-area-inset-bottom/);

    const dbSrc = fs.readFileSync(
      path.join(ROOT, "apps/api/src/store/db.ts"),
      "utf8",
    );
    const txIdx = dbSrc.indexOf("pg_advisory_xact_lock");
    const maxIdx = dbSrc.indexOf("booking_limit_exceeded", txIdx);
    assert.ok(txIdx > 0 && maxIdx > txIdx, "maxActive debe ir tras o lock");
    const insertIdx = dbSrc.indexOf("tx.insert(t.bookings)", txIdx);
    assert.ok(maxIdx < insertIdx, "maxActive antes do insert na mesma tx");
  });
});
