/**
 * REVISION-29 §3.7 Y5 — borrador, plantilla, publicar, horario aplicar, incompatibilidades.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev29-s37-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-29-s37";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  createFacilityAdmin,
  publishFacilityAdmin,
  applyOpeningHoursToFacilityUnits,
  listOpeningHours,
  upsertOpeningHours,
  updateClosureAdmin,
  createClosureAdmin,
  listClosures,
} = await import("./admin-ops.js");
const {
  defaultRulesTextForType,
  unitTemplatesForFacility,
} = await import("./facility-admin-templates.js");
const { listFacilities } = await import("./db.js");

describe("REVISION-29 §3.7 Y5 instalacións", () => {
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

  it("I1/I2: nova instalación en borrador con plantilla de pistas e normas en texto", async () => {
    const fac = await createFacilityAdmin(mid, "test", {
      name: "Pista proba rev29",
      type: "pista",
      address: "Rúa Proba 1",
      lat: 42.79,
      lng: -8.9,
      courtCount: 2,
    });
    assert.equal(fac.active, false);
    assert.equal(fac.units.length, 2);
    assert.ok(fac.rulesText && fac.rulesText.length >= 2);
    const publicBefore = await listFacilities(mid);
    assert.ok(!publicBefore.some((f) => f.id === fac.id));
  });

  it("I2: publicar activa instalación e unidades", async () => {
    const fac = await createFacilityAdmin(mid, "test", {
      name: "Publicar proba",
      type: "campo",
      address: "Campo 1",
      lat: 42.791,
      lng: -8.901,
      courtCount: 1,
    });
    const published = await publishFacilityAdmin(mid, fac.id, "test");
    assert.equal(published.active, true);
    assert.ok(published.units.every((u) => u.active));
    const publicAfter = await listFacilities(mid);
    assert.ok(publicAfter.some((f) => f.id === fac.id));
  });

  it("I3: rexeita coordenadas por defecto de Exemplo", async () => {
    await assert.rejects(
      () =>
        createFacilityAdmin(mid, "test", {
          name: "Sen mapa",
          type: "pista",
          address: "X",
          lat: 42.78,
          lng: -8.88,
        }),
      /coords_required/,
    );
  });

  it("I4: plantilla de normas por tipo non baleira", () => {
    const padel = defaultRulesTextForType("pista");
    assert.ok(padel.some((x) => x.gl.includes("pádel") || x.gl.includes("Calzado")));
  });

  it("I6: pavillón con media pista gera incompatibilidades", async () => {
    const tpl = unitTemplatesForFacility("pavillon", 1, true);
    assert.equal(tpl.length, 3);
    const fac = await createFacilityAdmin(mid, "test", {
      name: "Pavillón rev29",
      type: "pavillon",
      address: "Polideportivo",
      lat: 42.792,
      lng: -8.902,
      courtCount: 1,
      halfCourts: true,
    });
    const full = fac.units.find((u) => u.name.includes("completa"));
    assert.ok(full);
    assert.ok((full!.incompatibleWith ?? []).length >= 1);
  });

  it("I7: aplicar horario a todas as pistas do recinto", async () => {
    const fac = await createFacilityAdmin(mid, "test", {
      name: "Horario multi",
      type: "pista",
      address: "Varias pistas",
      lat: 42.793,
      lng: -8.903,
      courtCount: 2,
    });
    const [u1, u2] = fac.units;
    assert.ok(u1 && u2);
    await upsertOpeningHours(mid, "test", {
      unitId: u1.id,
      facilityId: fac.id,
      hours: [{ weekday: 3, open: "10:00", close: "14:00" }],
    });
    const r = await applyOpeningHoursToFacilityUnits(mid, "test", {
      facilityId: fac.id,
      sourceUnitId: u1.id,
    });
    assert.equal(r.applied, 1);
    const u2hours = await listOpeningHours(mid, u2.id);
    assert.ok(u2hours.some((h) => h.weekday === 3 && h.open === "10:00"));
  });

  it("I8: peche con hora e edición", async () => {
    const day = "2026-12-10";
    const created = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      startsAt: `${day}T14:00`,
      endsAt: `${day}T18:00`,
      reason: "Obras",
      notifyCitizens: false,
      confirm: true,
    });
    assert.ok(!created.needsConfirm);
    const closureId = created.ids?.[0] ?? created.id;
    assert.ok(closureId);
    await updateClosureAdmin(mid, closureId!, "test", {
      startsAt: `${day}T15:00`,
      endsAt: `${day}T17:00`,
      reason: "Obras tarde",
    });
    const rows = await listClosures(mid);
    const row = rows.find((c) => c.id === closureId);
    assert.equal(row?.startsAt, `${day}T15:00`);
    assert.equal(row?.reason, "Obras tarde");
  });
});
