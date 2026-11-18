/**
 * REVISION-25 N3 — Deputación (superadmin) só agregados por defecto; opt-in na personalización.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-deputacion-privacy-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-deputacion-privacy";
delete process.env.DATABASE_URL;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { completeRoutes } = await import("../routes/complete.js");
const { adminMellorasRoutes } = await import("../routes/admin-melloras.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");

async function cookieFor(userKey: keyof typeof SAML_DEMO_USERS): Promise<string> {
  const u = SAML_DEMO_USERS[userKey]!;
  const { key: _k, givenName: _g, familyName: _f, ...rest } = u;
  const sid = await createSession(rest);
  return `pa_sesion=${sid}`;
}

function buildApp() {
  const app = new Hono();
  app.route("/", completeRoutes);
  app.route("/", adminMellorasRoutes);
  return app;
}

describe("REVISION-25 N3 deputacion privacy", () => {
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

  it("superadmin: export full, persoas, auditoria e clubs → 403 sen opt-in", async () => {
    const cookie = await cookieFor("deputacion");
    const paths = [
      "/api/c/exemplo/admin/export?format=full",
      "/api/c/exemplo/admin/persoas?q=",
      "/api/c/exemplo/admin/auditoria",
      "/api/c/exemplo/admin/clubs",
    ];
    for (const p of paths) {
      const res = await app.request(p, { headers: { Cookie: cookie } });
      assert.equal(res.status, 403, p);
      const body = (await res.json()) as { reason?: string };
      assert.equal(body.reason, "deputacion_privacy", p);
    }
  });

  it("superadmin: dashboard agregado → 200 sen opt-in", async () => {
    const cookie = await cookieFor("deputacion");
    const res = await app.request("/api/c/exemplo/admin/dashboard", {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data?: unknown };
    assert.ok(body.data);
  });

  it("tras opt-in do concello, superadmin accede a PII", async () => {
    const adminCookie = await cookieFor("admin");
    const put = await app.request("/api/c/exemplo/admin/personalizacion", {
      method: "PUT",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deputacionCanViewPersonalData: true }),
    });
    assert.equal(put.status, 200);

    const cookie = await cookieFor("deputacion");
    const resExport = await app.request("/api/c/exemplo/admin/export?format=full", {
      headers: { Cookie: cookie },
    });
    assert.equal(resExport.status, 200);

    const resPersoas = await app.request("/api/c/exemplo/admin/persoas?q=", {
      headers: { Cookie: cookie },
    });
    assert.equal(resPersoas.status, 200);

    const resAudit = await app.request("/api/c/exemplo/admin/auditoria", {
      headers: { Cookie: cookie },
    });
    assert.equal(resAudit.status, 200);
  });
});
