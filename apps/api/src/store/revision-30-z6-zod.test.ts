/**
 * REVISION-30 Z6 — ZodError → 400 (non 500).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { z } from "zod";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r30-z6-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-r30-z6";
delete process.env.DATABASE_URL;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");
const { completeRoutes } = await import("../routes/complete.js");
const { optionalAuth } = await import("../middleware/auth.js");

function buildApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    return c.json({ error: "internal" }, 500);
  });
  app.use("*", optionalAuth);
  app.route("/", completeRoutes);
  return app;
}

describe("REVISION-30 Z6 ZodError", () => {
  const app = buildApp();

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("POST admin/revogar sen reason → 400", async () => {
    const dep = SAML_DEMO_USERS.deputacion!;
    const { key: _k, givenName: _g, familyName: _f, ...rest } = dep;
    const sid = await createSession(rest);
    const res = await app.request("/api/deputacion/concellos/exemplo/admin/revogar", {
      method: "POST",
      headers: {
        Cookie: `pa_sesion=${sid}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "validation_error");
  });
});
