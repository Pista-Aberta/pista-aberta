/**
 * REVISION-36 H1 — seedDb só con PA_DEMO (mesma lóxica que run-migrate.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, after, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const API = path.join(ROOT, "apps/api");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-h1-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
delete process.env.PA_DEMO;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-h1-seed-gate-secretxxxxxxxx";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");

function shouldSeed(): boolean {
  return process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true";
}

describe("REVISION-36 H1 seed só con PA_DEMO", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
  });
  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("fonte: run-migrate condiciona seedDb; index/setup non chaman seedDb", () => {
    const src = fs.readFileSync(path.join(API, "src/db/run-migrate.ts"), "utf8");
    assert.match(src, /PA_DEMO === "1"/);
    assert.match(src, /if \(paDemo\)/);
    assert.doesNotMatch(
      fs.readFileSync(path.join(API, "src/index.ts"), "utf8"),
      /seedDb\s*\(/,
    );
    assert.doesNotMatch(
      fs.readFileSync(path.join(API, "scripts/setup-muni.ts"), "utf8"),
      /seedDb\s*\(/,
    );
  });

  it("sen PA_DEMO → 0 concellos e 0 usuarios", async () => {
    delete process.env.PA_DEMO;
    if (shouldSeed()) await seedDb();
    const munis = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(t.municipalities);
    const users = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(t.users);
    assert.equal(Number(munis[0]?.n ?? 0), 0);
    assert.equal(Number(users[0]?.n ?? 0), 0);
  });

  it("PA_DEMO=1 → Exemplo e usuarios demo", async () => {
    process.env.PA_DEMO = "1";
    assert.equal(shouldSeed(), true);
    await seedDb();
    const exemplo = await getDb()
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.slug, "exemplo"))
      .limit(1);
    const users = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(t.users);
    assert.ok(exemplo[0]);
    assert.ok(Number(users[0]?.n ?? 0) >= 5);
  });
});
