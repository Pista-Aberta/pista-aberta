/**
 * REVISION-23 R6 — GET non muda preferencias; POST si.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r23-baixa-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-23-r6-long";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { signUnsubscribeToken } = await import("./unsubscribe.js");
const { avisosBaixaRoutes } = await import("../routes/avisos-baixa.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

describe("REVISION-23 R6 baixa confirmación", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("GET amosa botón e non desactiva correo", async () => {
    const userId = "user-cidada";
    const token = signUnsubscribeToken(userId);
    const res = await avisosBaixaRoutes.request(`/api/avisos/baixa?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Non quero recibir estes avisos/);
    assert.match(html, /method="post"/i);
    const u = (
      await getDb().select().from(t.users).where(eq(t.users.id, userId)).limit(1)
    )[0];
    assert.equal(u?.notifyEmail, true);
  });

  it("POST desactiva correo", async () => {
    const userId = "user-cidada";
    const token = signUnsubscribeToken(userId);
    const res = await avisosBaixaRoutes.request(
      `/api/avisos/baixa?token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { Accept: "application/json" } },
    );
    assert.equal(res.status, 200);
    const u = (
      await getDb().select().from(t.users).where(eq(t.users.id, userId)).limit(1)
    )[0];
    assert.equal(u?.notifyEmail, false);
  });
});
