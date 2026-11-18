/**
 * REVISION-29 Y2 — demo aceptar convite co NIF do convite.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r29-y2-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-r29-y2";
delete process.env.DATABASE_URL;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createInvitation, demoAcceptInvitation } = await import("./invitations.js");

describe("REVISION-29 Y2 convite demo", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    delete process.env.PA_DEMO;
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("demo-aceptar crea sesión e rol admin", async () => {
    const { token } = await createInvitation({
      municipalityId: "muni-proba",
      role: "admin",
      email: "nova.demo@proba.gal",
      nif: "44556677L",
      createdBy: "test",
    });
    const user = await demoAcceptInvitation(token);
    assert.equal(user.role, "admin");
    assert.equal(user.personIdentifier, "ES/ES/44556677L");
  });

  it("sen PA_DEMO → demo_only", async () => {
    process.env.PA_DEMO = "0";
    const { token } = await createInvitation({
      municipalityId: "muni-proba",
      role: "admin",
      nif: "12345678Z",
      createdBy: "test",
    });
    await assert.rejects(() => demoAcceptInvitation(token), /demo_only/);
    process.env.PA_DEMO = "1";
  });

  it("reconvite mesmo correo reutiliza conta (REVISION-38 K3: NIF obrigatorio)", async () => {
    const first = await createInvitation({
      municipalityId: "muni-proba",
      role: "admin",
      email: "reuso.demo@proba.gal",
      nif: "00000000T",
      createdBy: "test",
    });
    const u1 = await demoAcceptInvitation(first.token);
    assert.equal(u1.email, "reuso.demo@proba.gal");
    const second = await createInvitation({
      municipalityId: "muni-proba",
      role: "admin",
      email: "reuso.demo@proba.gal",
      nif: "00000000T",
      createdBy: "test",
    });
    const u2 = await demoAcceptInvitation(second.token);
    assert.equal(u2.id, u1.id);
    assert.equal(u2.role, "admin");
  });
});
