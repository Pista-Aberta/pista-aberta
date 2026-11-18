/**
 * REVISION-53 — D1 (inscrición infantil), D2 (aviso peche neutro), D3 (peches 404).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev53-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
delete process.env.AUTH_ELEVATED_SAML_ONLY;

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const webSrc = path.join(root, "apps/web/src");

function loadJson(rel: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(webSrc, rel), "utf8"),
  ) as Record<string, string>;
}

function loadSrc(rel: string): string {
  return fs.readFileSync(path.join(webSrc, rel), "utf8");
}

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createClosureAdmin } = await import("./admin-ops.js");

const mid = "muni-exemplo";

describe("REVISION-53", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("D1: ActivityDetailPage sen sesión → Inscribirme a acceso; sen familia → aviso", () => {
    const page = loadSrc("pages/ActivityDetailPage.tsx");
    assert.match(page, /showLoginToEnroll/);
    assert.match(page, /showNeedFamily/);
    assert.match(page, /activities\.needFamilyAges/);
    assert.match(page, /conta#familia/);
    assert.match(page, /acceso\?returnTo=/);

    const gl = loadJson("i18n/gl.json");
    const es = loadJson("i18n/es.json");
    assert.match(
      gl["activities.needFamilyAges"]!,
      /nenos e nenas de \{\{min\}\} a \{\{max\}\} anos/,
    );
    assert.doesNotMatch(gl["activities.needFamilyAges"]!, /Perfil → Familia/);
    assert.match(
      es["activities.needFamilyAges"]!,
      /niños y niñas de \{\{min\}\} a \{\{max\}\} años/,
    );
    /* REVISION-54 E3: ligazón sen repetir o texto do aviso. */
    assert.equal(gl["activities.needFamilyLink"], "Engadir a familia");
    assert.equal(es["activities.needFamilyLink"], "Añadir la familia");
  });

  it("D2: avisos de peche neutros gl/es (Peche/Cierre en …)", () => {
    const gl = loadJson("i18n/gl.json");
    const es = loadJson("i18n/es.json");
    assert.equal(
      gl["facility.closureNoticeUnit"],
      "Peche en {{unit}} do {{range}}: {{reason}}",
    );
    assert.equal(
      gl["facility.closureNoticeUnitSameDay"],
      "Peche en {{unit}} o {{day}}: {{reason}}",
    );
    assert.equal(
      gl["facility.closureNotice"],
      "Peche do {{range}}: {{reason}}",
    );
    assert.equal(
      gl["facility.closureNoticeSameDay"],
      "Peche o {{day}}: {{reason}}",
    );
    assert.equal(
      es["facility.closureNoticeUnit"],
      "Cierre en {{unit}} del {{range}}: {{reason}}",
    );
    assert.equal(
      es["facility.closureNoticeUnitSameDay"],
      "Cierre en {{unit}} el {{day}}: {{reason}}",
    );
    assert.equal(
      es["facility.closureNotice"],
      "Cierre del {{range}}: {{reason}}",
    );
    assert.equal(
      es["facility.closureNoticeSameDay"],
      "Cierre el {{day}}: {{reason}}",
    );
    const notice = loadSrc("lib/closure-notice.ts");
    assert.match(notice, /Peche en \$\{unit\}/);
    assert.equal(notice.includes("pechada"), false);
  });

  it("D3: facilityId inexistente → facility_not_found", async () => {
    await assert.rejects(
      () =>
        createClosureAdmin(mid, "test", {
          facilityId: "fac-exemplo-futbol",
          startsAt: "2027-03-01T00:00",
          endsAt: "2027-03-02T23:59",
          reason: "proba D3 facility",
        }),
      /facility_not_found/,
    );
  });

  it("D3: unitId allea ou inexistente → unit_not_found", async () => {
    await assert.rejects(
      () =>
        createClosureAdmin(mid, "test", {
          facilityId: "fac-exemplo-pav",
          unitId: "unit-padel-1",
          startsAt: "2027-03-03T00:00",
          endsAt: "2027-03-03T23:59",
          reason: "proba D3 unit allea",
        }),
      /unit_not_found/,
    );
    await assert.rejects(
      () =>
        createClosureAdmin(mid, "test", {
          facilityId: "fac-exemplo-pav",
          unitId: "unit-nonexistent-r53",
          startsAt: "2027-03-04T00:00",
          endsAt: "2027-03-04T23:59",
          reason: "proba D3 unit missing",
        }),
      /unit_not_found/,
    );
  });
});
