/**
 * REVISION-22 A6 — renovar sesión / sessionExpiresAt.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-session-a6-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-22-a6";
process.env.SESSION_MINUTES = "10";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  createSession,
  getSessionMeta,
  renewSession,
  sessionTtlMs,
  destroySession,
} = await import("./sessions.js");

describe("REVISION-22 A6 session renew", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("SESSION_MINUTES define o TTL", () => {
    assert.equal(sessionTtlMs(), 10 * 60 * 1000);
  });

  it("renewSession estende expiresAt", async () => {
    const sid = await createSession({
      id: "user-cidada",
      municipalityId: "muni-exemplo",
      role: "citizen",
      displayName: "Cidadá demo",
      locale: "gl",
    });
    const before = await getSessionMeta(sid);
    assert.ok(before);
    const left = before!.expiresAt.getTime() - Date.now();
    assert.ok(left > 8 * 60 * 1000 && left <= 10 * 60 * 1000);

    await new Promise((r) => setTimeout(r, 50));
    const renewed = await renewSession(sid);
    assert.ok(renewed);
    assert.ok(
      renewed!.expiresAt.getTime() >= before!.expiresAt.getTime(),
      "a renovación non debe acurtar",
    );
    const left2 = renewed!.expiresAt.getTime() - Date.now();
    assert.ok(left2 > 8 * 60 * 1000);

    await destroySession(sid);
    assert.equal(await renewSession(sid), null);
  });

  it("REVISION-23 R9: persoal ten idle curto e renovación non pasa do absoluto", async () => {
    const {
      sessionTtlMs,
      sessionAbsoluteMaxMs,
      isStaffSessionRole,
    } = await import("./sessions.js");
    assert.equal(isStaffSessionRole("admin"), true);
    assert.equal(isStaffSessionRole("citizen"), false);
    /* Con SESSION_MINUTES=10 o idle é 10 min e o absoluto 40 min. */
    assert.equal(sessionTtlMs("admin"), 10 * 60 * 1000);
    assert.equal(sessionAbsoluteMaxMs("admin"), 40 * 60 * 1000);

    const sid = await createSession({
      id: "user-admin",
      municipalityId: "muni-exemplo",
      role: "admin",
      displayName: "Admin",
      locale: "gl",
    });
    const meta = await getSessionMeta(sid);
    assert.ok(meta?.createdAt);
    const renewed = await renewSession(sid);
    assert.ok(renewed);
    const abs =
      meta!.createdAt.getTime() + sessionAbsoluteMaxMs("admin");
    assert.ok(renewed!.expiresAt.getTime() <= abs);
    await destroySession(sid);
  });
});
