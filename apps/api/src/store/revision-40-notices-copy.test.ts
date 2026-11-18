/**
 * REVISION-40 T2 — ningún aviso da demo leva datas ISO no corpo.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r40-notices-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { listNotices } = await import("./extra.js");
const { ensureAnaWaitlistOffer } = await import("./demo-bookings.js");
const { ensureRollingDemoSlots } = await import("./demo-slots.js");

const ISO = /\d{4}-\d{2}-\d{2}/;

describe("REVISION-40 notices copy", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    const now = new Date();
    await ensureRollingDemoSlots(now);
    await ensureAnaWaitlistOffer(now);
  });

  after(async () => {
    await closeDb();
  });

  it("avisos de Ana (user-cidada) sen ISO no title/body", async () => {
    const rows = await listNotices("muni-exemplo", "user-cidada");
    const bad = rows
      .filter((n) => ISO.test(n.title) || ISO.test(n.body))
      .map((n) => `${n.type}: ${n.title} · ${n.body}`);
    assert.deepEqual(bad, [], bad.join("\n"));
  });

  it("tipos de aviso son do conxunto coñecido", async () => {
    const rows = await listNotices("muni-exemplo", "user-cidada");
    const allowed = new Set(["reminder", "closure", "waitlist", "change", "info"]);
    for (const n of rows) {
      assert.ok(allowed.has(n.type), `tipo descoñecido: ${n.type}`);
    }
  });
});
