/**
 * REVISION-23 R10 — importación con conflitos non crea nada.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r23-import-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-23-r10";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  exportFullMunicipality,
  importMunicipalityDump,
  findImportConflicts,
} = await import("./muni-portability.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

describe("REVISION-23 R10 import transacción", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("dry-run e conflito de correo: nada creado", async () => {
    const dump = await exportFullMunicipality("muni-proba");
    /* Forzar correo que xa existe en Exemplo */
    dump.users = [
      {
        ...dump.users[0]!,
        email: "admin.exemplo@demo.pistaaberta.com",
      },
    ];
    const conflicts = await findImportConflicts(dump);
    assert.ok(conflicts.emails.length >= 1);

    const before = await getDb().select().from(t.municipalities);
    await assert.rejects(
      () => importMunicipalityDump(dump, { slug: "import-fail-r23" }),
      /import_conflicts/,
    );
    const after = await getDb().select().from(t.municipalities);
    assert.equal(after.length, before.length);
    const ghost = after.find((m) => m.slug === "import-fail-r23");
    assert.equal(ghost, undefined);

    const dry = await importMunicipalityDump(dump, {
      slug: "import-fail-r23",
      dryRun: true,
    });
    assert.equal(dry.dryRun, true);
    assert.ok((dry.conflicts?.emails.length ?? 0) >= 1);
  });
});
