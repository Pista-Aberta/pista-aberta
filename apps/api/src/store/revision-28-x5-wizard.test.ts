/**
 * REVISION-28 X5 + REVISION-29 Y14 — wizard só superadmin (tamén con PA_DEMO=1).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r28-x5-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-28-x5";
delete process.env.DATABASE_URL;

const savedPaDemo = process.env.PA_DEMO;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { completeRoutes } = await import("../routes/complete.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");

async function cookieFor(
  userKey: keyof typeof SAML_DEMO_USERS,
): Promise<string> {
  const u = SAML_DEMO_USERS[userKey]!;
  const { key: _k, givenName: _g, familyName: _f, ...rest } = u;
  const sid = await createSession(rest);
  return `pa_sesion=${sid}`;
}

function buildApp() {
  const app = new Hono();
  app.route("/", completeRoutes);
  return app;
}

describe("REVISION-28 X5 / Y14 wizard auth", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });
  after(async () => {
    process.env.PA_DEMO = savedPaDemo;
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("sen sesión e PA_DEMO=0 → 401", async () => {
    process.env.PA_DEMO = "0";
    const app = buildApp();
    const res = await app.request("/api/municipalities/wizard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Proba X", slug: `proba-x5-${Date.now()}` }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "unauthorized");
  });

  it("sen sesión e PA_DEMO=1 → 401 (Y14: sen sandbox público)", async () => {
    process.env.PA_DEMO = "1";
    const app = buildApp();
    const slug = `sandbox-x5-${Date.now()}`;
    const res = await app.request("/api/municipalities/wizard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sandbox X5", slug }),
    });
    assert.equal(res.status, 401);
  });

  it("admin (non superadmin) con PA_DEMO=0 → 403", async () => {
    process.env.PA_DEMO = "0";
    const app = buildApp();
    const cookie = await cookieFor("admin");
    const res = await app.request("/api/municipalities/wizard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        name: "Proba Admin",
        slug: `proba-admin-${Date.now()}`,
      }),
    });
    assert.equal(res.status, 403);
  });

  it("admin (non superadmin) con PA_DEMO=1 → 403", async () => {
    process.env.PA_DEMO = "1";
    const app = buildApp();
    const cookie = await cookieFor("admin");
    const res = await app.request("/api/municipalities/wizard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        name: "Proba Admin Demo",
        slug: `proba-admin-demo-${Date.now()}`,
      }),
    });
    assert.equal(res.status, 403);
  });

  it("superadmin crea concello real (sandbox=false)", async () => {
    process.env.PA_DEMO = "0";
    const app = buildApp();
    const cookie = await cookieFor("deputacion");
    const slug = `terceiro-x5-${Date.now()}`;
    const res = await app.request("/api/municipalities/wizard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ name: "Concello de Terceiro", slug }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.sandbox, false);
    assert.equal(body.data.slug, slug);
  });

  it("superadmin con PA_DEMO=1 → 201", async () => {
    process.env.PA_DEMO = "1";
    const app = buildApp();
    const cookie = await cookieFor("deputacion");
    const slug = `terceiro-y14-${Date.now()}`;
    const res = await app.request("/api/municipalities/wizard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ name: "Concello de Proba", slug }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.sandbox, false);
    assert.equal(body.data.slug, slug);
  });
});
