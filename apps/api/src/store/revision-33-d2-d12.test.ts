/**
 * REVISION-33 D2 (reset só superadmin) + D12 (demo-aceptar PA_DEMO primeiro).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r33-d2-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-r33-d2d12";
process.env.PA_DEMO = "1";
delete process.env.DATABASE_URL;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

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

describe("REVISION-33 D2 demo reset", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });
  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("admin de concello → 403; superadmin → 200 + last at", async () => {
    const app = buildApp();
    const adminCookie = await cookieFor("admin");
    const denied = await app.request("/api/demo/reset", {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(denied.status, 403);

    const depCookie = await cookieFor("deputacion");
    const ok = await app.request("/api/demo/reset", {
      method: "POST",
      headers: {
        Cookie: depCookie,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { data: { at: string } };
    assert.ok(body.data.at);

    /* Tras o reset, nova sesión (a BD reseedeou). */
    const depCookie2 = await cookieFor("deputacion");
    const last = await app.request("/api/demo/reset", {
      headers: { Cookie: depCookie2 },
    });
    assert.equal(last.status, 200);
    const lastBody = (await last.json()) as { data: { at: string | null } };
    assert.equal(lastBody.data.at, body.data.at);
  });
});

describe("REVISION-33 D12 demo-aceptar PA_DEMO primeiro", () => {
  it("index.ts comproba PA_DEMO antes de mirar o convite", () => {
    const src = fs.readFileSync(path.join(ROOT, "apps/api/src/index.ts"), "utf8");
    const idx = src.indexOf('app.post("/api/convite/:token/demo-aceptar"');
    assert.ok(idx > 0);
    const slice = src.slice(idx, idx + 900);
    const demoFirst = slice.indexOf("PA_DEMO");
    const inviteLookup = slice.indexOf("getInvitationByToken");
    assert.ok(demoFirst >= 0, "falta garda PA_DEMO");
    assert.ok(
      inviteLookup > demoFirst,
      "PA_DEMO debe ir antes de getInvitationByToken",
    );
  });
});
