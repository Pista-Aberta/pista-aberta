/**
 * REVISION-36 H4 / REVISION-37 I3 — o nome do convite úsase sempre ao aceptar
 * (tamén cando o do certificado xa pasou por toProperName).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-h4-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-h4-invite-name-secretxxxx";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createInvitation, acceptInvitation } = await import("./invitations.js");
const { toProperName } = await import("../identity/certificate.js");
const t = await import("../db/schema.js");

describe("REVISION-36 H4 / REVISION-37 I3 nome no convite", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });
  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("aceptar usa o nome do convite aínda con nome xa pasado por toProperName", async () => {
    const nifOk = "44444444A";
    const email = `h4.${Date.now()}@demo.pistaaberta.com`;
    const certRaw = "CARLA LOPEZ";
    const certProper = toProperName(certRaw); /* «Carla Lopez» */
    assert.equal(certProper, "Carla Lopez");

    const { token } = await createInvitation({
      municipalityId: "muni-exemplo",
      role: "staff",
      email,
      nif: nifOk,
      displayName: "Carla López",
      createdBy: "test-h4",
    });
    const userId = `user-h4-${Date.now()}`;
    await getDb().insert(t.users).values({
      id: userId,
      municipalityId: "muni-exemplo",
      role: "citizen",
      displayName: certProper,
      email: null,
      personIdentifier: `ES/ES/${nifOk}`,
      locale: "gl",
      active: true,
    });
    const user = await acceptInvitation({
      token,
      user: {
        id: userId,
        municipalityId: "muni-exemplo",
        role: "citizen",
        displayName: certProper,
        personIdentifier: `ES/ES/${nifOk}`,
        locale: "gl",
      },
    });
    assert.equal(user.displayName, "Carla López");
    const row = (
      await getDb().select().from(t.users).where(eq(t.users.id, user.id)).limit(1)
    )[0];
    assert.equal(row?.displayName, "Carla López");
  });

  it("create-admin.ts pasa displayName ao createInvitation", () => {
    const src = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../scripts/create-admin.ts",
      ),
      "utf8",
    );
    assert.match(src, /displayName,/);
  });
});
