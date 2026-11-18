/**
 * REVISION-40 N2 — settings.ineCode na alta e backfill por slug do censo.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r40-n2-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-40-n2-ine-xx";
process.env.PA_DEMO = "0";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createMunicipalityFromWizard } = await import("./municipality-launch.js");
const { resolveMunicipalityIne } = await import("./meteogalicia.js");
const t = await import("../db/schema.js");

describe("REVISION-40 N2 ineCode", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("alta Terceiro → settings.ineCode 32078 e resolveMunicipalityIne", async () => {
    const slug = `terceiro-n2-${Date.now()}`;
    const m = await createMunicipalityFromWizard({
      name: "Concello de Terceiro",
      slug,
      ine: "32078",
      markedFacilities: ["Pistas (3)"],
      schedule: { pista: { open: "09:00", close: "22:00" } },
      norms: {},
      adminEmail: "admin@terceiro-n2.gal",
      adminDisplayName: "Admin Terceiro",
      adminNif: "12345678Z",
      sandbox: true,
      createdBy: "test",
    });
    assert.equal(m.settings.ineCode, "32078");
    assert.equal(resolveMunicipalityIne(m), "32078");
  });

  it("migración backfill: slug do censo → ineCode se faltaba", async () => {
    const db = getDb();
    const id = `muni-sarreaus-bf-${Date.now()}`;
    await db.insert(t.municipalities).values({
      id,
      slug: "sarreaus",
      name: "Concello de Sarreaus (sen INE)",
      accentColor: "#5A4636",
      locales: ["gl", "es"],
      settings: {
        maxHoursPerWeek: 4,
        bookingAntelationDays: 7,
      },
    });
    await db
      .insert(t.meta)
      .values({ key: "rev40_ine_backfill", value: "pending" })
      .onConflictDoUpdate({
        target: t.meta.key,
        set: { value: "pending" },
      });
    await migrateSchema();
    const row = await db
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.id, id))
      .limit(1);
    assert.equal(row[0]?.settings.ineCode, "32078");
    assert.equal(
      resolveMunicipalityIne({
        slug: "sarreaus",
        settings: row[0]!.settings,
      }),
      "32078",
    );
  });
});
