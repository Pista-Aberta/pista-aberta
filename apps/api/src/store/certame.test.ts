/**
 * Rev4 certame: OpenAPI, demo reset hour, resetDemoData en modo demo.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-certame-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-certame";
delete process.env.DATABASE_URL;
delete process.env.SMTP_HOST;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
await initDb();
await migrateSchema();
await seedDb();

const { openApiDocument } = await import("../openapi.js");
const { isDemoResetHour, resetDemoData } = await import("./demo-reset.js");
const t = await import("../db/schema.js");

describe("Rev4 certame", () => {
  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("OpenAPI 3.1 ten info e paths clave", () => {
    assert.equal(openApiDocument.openapi, "3.1.0");
    assert.ok(openApiDocument.paths["/health"]);
    assert.ok(openApiDocument.paths["/api/openapi.json"]);
    assert.ok(openApiDocument.paths["/api/demo/reset"]);
  });

  it("isDemoResetHour detecta as 04:xx Madrid", () => {
    // 2026-10-24 04:30 CEST = 02:30 UTC
    const at4 = new Date("2026-10-24T02:30:00Z");
    assert.equal(isDemoResetHour(at4), true);
    const at12 = new Date("2026-10-24T10:00:00Z");
    assert.equal(isDemoResetHour(at12), false);
  });

  it("resetDemoData reseeda e deixa Exemplo", async () => {
    const before = await getDb().select().from(t.municipalities);
    assert.ok(before.length >= 1);
    const r = await resetDemoData("test");
    assert.equal(r.ok, true);
    const after = await getDb().select().from(t.municipalities);
    assert.ok(after.some((m) => m.slug === "exemplo"));
    const meta = await getDb().select().from(t.meta);
    assert.ok(meta.some((m) => m.key === "seed_version"));
  });
});
