/**
 * REVISION-30 Z16 — install multiconcello + convite Deputación (fluxo real en PGlite).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r30-z16-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-r30-z16";
process.env.PA_DEMO = "1";
delete process.env.DATABASE_URL;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { demoAcceptInvitation } = await import("./invitations.js");
const { createSession } = await import("../identity/sessions.js");
const { completeRoutes } = await import("../routes/complete.js");
const { optionalAuth } = await import("../middleware/auth.js");
const {
  getDeputacionOrganization,
  ensureDeputacionPlatformMunicipality,
  ensureDemoDeputacionEntity,
  inviteDeputacionManager,
  DEPUTACION_PLATFORM_MUNI_ID,
} = await import("./deputacion-org.js");

describe("REVISION-30 Z16 install+Deputación e2e", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureDeputacionPlatformMunicipality();
    await ensureDemoDeputacionEntity();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("install.sh documenta multiconcello non interactivo", () => {
    const install = fs.readFileSync(path.join(ROOT, "install.sh"), "utf8");
    assert.match(install, /--deputacion --invite/);
    assert.match(install, /NONINTERACTIVE|non-?interactive|DEPUTACION_EMAIL|DEPUTACION_NAME/i);
  });

  it("convite Deputación → aceptar → /api/deputacion/concellos 200", async () => {
    const org = await getDeputacionOrganization();
    assert.ok(org, "organización Deputación");
    assert.ok(DEPUTACION_PLATFORM_MUNI_ID);

    const inv = await inviteDeputacionManager({
      email: "xestora.z16@deputacion.gal",
      name: "Xestora Z16",
      nif: "81234567Q",
      createdBy: "test",
    });

    const user = await demoAcceptInvitation(inv.token);
    assert.equal(user.role, "superadmin");

    const sid = await createSession(user);
    const app = new Hono();
    app.use("*", optionalAuth);
    app.route("/", completeRoutes);
    const res = await app.request("/api/deputacion/concellos", {
      headers: { Cookie: `pa_sesion=${sid}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: unknown[] };
    assert.ok(Array.isArray(body.data));
  });
});
