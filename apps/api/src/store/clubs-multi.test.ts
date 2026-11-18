/**
 * REVISION-22 B3 — varias persoas responsables por club.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-clubs-multi-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-22-b3";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  addClubResponsable,
  listClubResponsables,
  removeClubResponsable,
  listLinkedClubsForUser,
  userCanActAsClub,
} = await import("./club-members.js");
const t = await import("../db/schema.js");

describe("REVISION-22 B3 clubs multi-responsable", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("engade e quita un responsable vinculado a userId", async () => {
    const clubId = "club-basquet";
    const citizens = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.email, "ana.demo@demo.pistaaberta.com"))
      .limit(1);
    const ana = citizens[0];
    assert.ok(ana);

    const added = await addClubResponsable({
      municipalityId: "muni-exemplo",
      clubId,
      userId: ana.id,
      role: "manager",
      actor: "test-admin",
    });
    assert.equal(added.userId, ana.id);

    const list = await listClubResponsables(clubId, "muni-exemplo");
    assert.ok(list.some((m) => m.userId === ana.id));

    const linked = await listLinkedClubsForUser(ana.id, "muni-exemplo");
    assert.ok(linked.some((c) => c.id === clubId));

    assert.equal(
      await userCanActAsClub(
        {
          id: ana.id,
          municipalityId: "muni-exemplo",
          role: "citizen",
          displayName: ana.displayName,
          locale: "gl",
        },
        clubId,
        "muni-exemplo",
      ),
      true,
    );

    assert.equal(
      await userCanActAsClub(
        {
          id: "admin-other-home",
          municipalityId: "muni-terceiro",
          role: "admin",
          displayName: "Admin Terceiro",
          locale: "gl",
          linkedMuniRoles: [
            {
              role: "admin",
              municipalityId: "muni-exemplo",
              municipalityName: "Exemplo",
              label: "Admin",
            },
          ],
        },
        clubId,
        "muni-exemplo",
      ),
      true,
    );

    await removeClubResponsable({
      municipalityId: "muni-exemplo",
      clubId,
      memberId: added.id,
      actor: "test-admin",
    });
    const after = await listClubResponsables(clubId, "muni-exemplo");
    assert.ok(!after.some((m) => m.id === added.id));
  });
});
