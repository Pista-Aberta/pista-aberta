/**
 * REVISION-34 F2 — NIF obrigatorio en Convidar xestora.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r34-f2-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-revision-34-f2";
delete process.env.DATABASE_URL;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { completeRoutes } = await import("../routes/complete.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");

async function cookieDeputacion(): Promise<string> {
  const u = SAML_DEMO_USERS.deputacion!;
  const { key: _k, givenName: _g, familyName: _f, ...rest } = u;
  const sid = await createSession(rest);
  return `pa_sesion=${sid}`;
}

describe("REVISION-34 F2 nif xestora", () => {
  const app = new Hono();
  app.route("/", completeRoutes);

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("sen NIF → 400 nif_invalid", async () => {
    const cookie = await cookieDeputacion();
    const res = await app.request("/api/deputacion/persoas/convite", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nova.xestora@example.com" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "nif_invalid");
  });

  it("NIF malo → 400 nif_invalid", async () => {
    const cookie = await cookieDeputacion();
    const res = await app.request("/api/deputacion/persoas/convite", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nova.xestora@example.com", nif: "XXXX" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "nif_invalid");
  });
});
