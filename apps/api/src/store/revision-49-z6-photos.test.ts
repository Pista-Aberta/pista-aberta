/**
 * REVISION-49 Z6 — limpeza de fotos sintéticas só por tamaño/marca, unha vez.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r49z6-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");

describe("REVISION-49 Z6 limpeza fotos sintéticas", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("non borra unha foto JPEG subida (tamaño distinto) e a marca queda", async () => {
    const uploaded =
      "data:image/jpeg;base64," + "A".repeat(50_000);
    await getDb()
      .update(t.facilities)
      .set({ imageDataUrl: uploaded, imageAlt: "Foto subida demo" })
      .where(eq(t.facilities.id, "fac-exemplo-pav"));

    /* Segunda pasada do seed (versión igual) — non debe tocar a foto. */
    await seedDb();

    const row = (
      await getDb()
        .select({ imageDataUrl: t.facilities.imageDataUrl })
        .from(t.facilities)
        .where(eq(t.facilities.id, "fac-exemplo-pav"))
        .limit(1)
    )[0]!;
    assert.equal(row.imageDataUrl, uploaded);

    const flag = (
      await getDb()
        .select()
        .from(t.meta)
        .where(eq(t.meta.key, "rev49_cleared_rev47_photos"))
        .limit(1)
    )[0];
    assert.equal(flag?.value, "1");
  });

  it("borra só o JPEG sintético rev47 (tamaño exacto) a primeira vez", async () => {
    /* Simular data URL do tamaño exacto do pavillón rev47. */
    const synthetic =
      "data:image/jpeg;base64," + "B".repeat(14_359 - "data:image/jpeg;base64,".length);
    assert.equal(synthetic.length, 14_359);

    await getDb()
      .update(t.facilities)
      .set({ imageDataUrl: synthetic, imageAlt: "sintetica" })
      .where(eq(t.facilities.id, "fac-exemplo-padel"));

    /* Resetear a marca para forzar unha limpeza. */
    await getDb().delete(t.meta).where(eq(t.meta.key, "rev49_cleared_rev47_photos"));

    await seedDb();

    const row = (
      await getDb()
        .select({ imageDataUrl: t.facilities.imageDataUrl })
        .from(t.facilities)
        .where(eq(t.facilities.id, "fac-exemplo-padel"))
        .limit(1)
    )[0]!;
    assert.equal(row.imageDataUrl, null);
  });
});
