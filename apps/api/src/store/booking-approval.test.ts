/**
 * REVISION-20 H2: whoCanBook + approvalRequired.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-booking-h2-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  createBooking,
  approvePendingBooking,
  rejectPendingBooking,
  listSlots,
} = await import("./db.js");
const { putFacilityNormas } = await import("./admin-ops.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);
async function freeSlot(unitId = "unit-padel-1") {
  /* Mañá+ para non chocar con slot_in_past (hoxe á noite). */
  const from = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 1);
  const slots = await listSlots({
    municipalityId: "muni-exemplo",
    unitId,
    date: undefined,
  });
  const free = slots.find(
    (s) => !s.occupied && !s.closed && s.date >= from,
  );
  assert.ok(free, "precisa franxa libre futura");
  return free!;
}

describe("REVISION-20 H2 whoCanBook e approvalRequired", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("Só clubs → veciñanza who_cannot_book", async () => {
    await putFacilityNormas("muni-exemplo", "fac-exemplo-padel", "test", {
      rulesOverride: { whoCanBook: "clubs" },
    });
    const slot = await freeSlot();
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: "muni-exemplo",
          slotId: slot.id,
          userId: "user-cidada",
          userDisplayName: "Ana Demo",
          userRole: "citizen",
        }),
      /who_cannot_book/,
    );
    await putFacilityNormas("muni-exemplo", "fac-exemplo-padel", "test", {
      rulesOverride: { whoCanBook: "ambas" },
    });
  });

  it("Require aprobación → Pendente; aprobar → Confirmada", async () => {
    await putFacilityNormas("muni-exemplo", "fac-exemplo-padel", "test", {
      rulesOverride: { approvalRequired: true, whoCanBook: "ambas" },
    });
    const slot = await freeSlot();
    const b = await createBooking({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
      userRole: "citizen",
    });
    assert.equal(b.status, "pending");
    const occ = await listSlots({
      municipalityId: "muni-exemplo",
      unitId: slot.unitId,
      date: slot.date,
    });
    assert.ok(occ.find((s) => s.id === slot.id)?.occupied);

    const ok = await approvePendingBooking("muni-exemplo", b.id, "admin-test");
    assert.equal(ok.status, "confirmed");

    await putFacilityNormas("muni-exemplo", "fac-exemplo-padel", "test", {
      rulesOverride: { approvalRequired: false },
    });
  });

  it("Rexeitar pendente libera a franxa", async () => {
    await putFacilityNormas("muni-exemplo", "fac-exemplo-padel", "test", {
      rulesOverride: { approvalRequired: true },
    });
    const slot = await freeSlot("unit-padel-2");
    /* Usuario distinto: a proba anterior deixa unha confirmada a Ana. */
    const b = await createBooking({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-brais",
      userDisplayName: "Luis Demo",
      userRole: "citizen",
    });
    assert.equal(b.status, "pending");
    await rejectPendingBooking("muni-exemplo", b.id, "admin-test");
    const again = await listSlots({
      municipalityId: "muni-exemplo",
      unitId: slot.unitId,
      date: slot.date,
    });
    const s = again.find((x) => x.id === slot.id);
    assert.ok(s && !s.occupied, "franxa libre tras rexeitar");
    await putFacilityNormas("muni-exemplo", "fac-exemplo-padel", "test", {
      rulesOverride: { approvalRequired: false },
    });
  });
});
