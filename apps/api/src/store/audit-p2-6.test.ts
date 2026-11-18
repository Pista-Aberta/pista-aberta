import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-audit-p26-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { listNotices, listAudit, listWaitlist } = await import("./extra.js");
const { getIncident, listIncidents } = await import("./incidents.js");
const { listBookingsForExport } = await import("./bounded-export.js");

describe("audit P2.6 bounded operational queries", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    const now = new Date();
    await getDb().insert(t.incidents).values(
      Array.from({ length: 4 }, (_, i) => ({
        id: `inc-p26-${i}`,
        municipalityId: "muni-exemplo",
        facilityId: null,
        userId: "user-cidada",
        userDisplayName: "Ana",
        body: `Incidencia P2.6 ${i}`,
        photoDataUrl: `data:image/png;base64,PHOTO_${i}`,
        status: i % 2 ? "done" : "open",
        createdAt: new Date(now.getTime() + i * 1_000),
      })),
    );
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("pages every operational collection and bounds exports", async () => {
    assert.ok((await listNotices("muni-exemplo", "user-cidada", { limit: 1 })).length <= 1);
    assert.ok((await listAudit("muni-exemplo", { limit: 1 })).length <= 1);
    assert.ok((await listWaitlist("muni-exemplo", { limit: 1 })).length <= 1);
    assert.equal((await listIncidents("muni-exemplo", { limit: 2 })).length, 2);
    assert.ok(
      (
        await listBookingsForExport({
          municipalityId: "muni-exemplo",
          dateFrom: "2000-01-01",
          dateTo: "2100-01-01",
          limit: 1,
        })
      ).length <= 1,
    );
  });

  it("keeps base64 photos out of list rows and exposes them on detail", async () => {
    const rows = await listIncidents("muni-exemplo", { status: "open", limit: 10 });
    const row = rows.find((candidate) => candidate.id.startsWith("inc-p26-"));
    assert.ok(row);
    assert.equal("photoDataUrl" in row, false);

    const detail = await getIncident("muni-exemplo", row.id);
    assert.match(detail?.photoDataUrl ?? "", /^data:image\/png;base64,/);
  });

  it("has indexed, atomic reminder idempotency claims", async () => {
    const claim = {
      key: "reminder-24h-p26",
      municipalityId: "muni-exemplo",
      userId: "user-cidada",
    };
    const first = await getDb()
      .insert(t.notificationDedupes)
      .values(claim)
      .onConflictDoNothing()
      .returning();
    const second = await getDb()
      .insert(t.notificationDedupes)
      .values(claim)
      .onConflictDoNothing()
      .returning();
    assert.equal(first.length, 1);
    assert.equal(second.length, 0);

    const source = fs.readFileSync(
      new URL("./rev4-ops.ts", import.meta.url),
      "utf8",
    );
    const reminderBody = source.slice(
      source.indexOf("export async function sendBookingReminders"),
      source.indexOf("export async function updateNotifyPrefs"),
    );
    assert.doesNotMatch(reminderBody, /\.from\(t\.notices\)/);
    assert.match(reminderBody, /\.onConflictDoNothing\(\)/);
  });
});
