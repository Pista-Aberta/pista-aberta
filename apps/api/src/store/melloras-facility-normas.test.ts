/**
 * P4 normas por instalación: rulesOverride (quién reserva, aprobación, prezo).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-fac-normas-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { getNormas, putFacilityNormas } = await import("./admin-ops.js");

describe("melloras facility normas P4", () => {
  const mid = "muni-exemplo";
  const facilityId = "fac-exemplo-padel";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await putFacilityNormas(mid, facilityId, "test", {
      rulesOverride: null,
      rulesText: null,
    });
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("putFacilityNormas garda whoCanBook / approval / prezo", async () => {
    const data = await putFacilityNormas(mid, facilityId, "test", {
      rulesOverride: {
        whoCanBook: "vecinhaza",
        approvalRequired: true,
        informativePrice: "2 € / hora",
      },
      rulesText: [
        {
          id: "rt-fac",
          order: 0,
          gl: "Norma da instalación",
          es: "Norma de la instalación",
        },
      ],
    });
    assert.equal(data.source, "facility");
    assert.equal(data.rules.whoCanBook, "vecinhaza");
    assert.equal(data.rules.approvalRequired, true);
    assert.equal(data.rules.informativePrice, "2 € / hora");
    assert.equal(data.rulesText[0]?.gl, "Norma da instalación");
    assert.equal(data.rulesOverride?.whoCanBook, "vecinhaza");

    const again = await getNormas(mid, facilityId);
    assert.equal(again.rules.whoCanBook, "vecinhaza");
    assert.equal(again.source, "facility");

    const muni = await getNormas(mid);
    assert.notEqual(muni.rules.whoCanBook, "vecinhaza");
  });
});
