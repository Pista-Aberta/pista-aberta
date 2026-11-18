/**
 * REVISION-56 H9 — non ofertar waitlist en franxa pechada.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev57-h9-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { ensureSlotsAhead } = await import("./slots-ahead.js");
const { offerWaitlistOnCancel, addWaitlist } = await import("./extra.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);

describe("REVISION-56 H9 waitlist closed slot", () => {
  const mid = "muni-exemplo";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 7 });
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("H9: slot pechado → null e entradas waiting/offered → expired", async () => {
    const day = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 2);
    const slot = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, day),
            eq(t.timeSlots.closed, false),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(slot);

    await addWaitlist({
      municipalityId: mid,
      slotId: slot.id,
      userId: "user-cidada",
      userDisplayName: "Ana",
    });

    await getDb()
      .update(t.timeSlots)
      .set({ closed: true, closedReason: "peche" })
      .where(eq(t.timeSlots.id, slot.id));

    const offered = await offerWaitlistOnCancel(slot.id, mid);
    assert.equal(offered, null);

    const entries = await getDb()
      .select()
      .from(t.waitlistEntries)
      .where(eq(t.waitlistEntries.slotId, slot.id));
    assert.ok(entries.length >= 1);
    assert.ok(entries.every((e) => e.status === "expired"));
  });
});
