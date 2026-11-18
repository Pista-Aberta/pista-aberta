/**
 * REVISION-28 §3.7 — peches con rango, desactivar con impacto, censo OSM.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev28-s37-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-28-s37";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  previewClosureImpact,
  createClosureAdmin,
  previewFacilityDeactivateImpact,
} = await import("./admin-ops.js");
const { listCensusFacilitySuggestions } = await import("./census-facilities.js");
const { ensureSlotsAhead } = await import("./slots-ahead.js");
const { createBooking } = await import("./db.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);
const t = await import("../db/schema.js");
const { and, eq } = await import("drizzle-orm");

describe("REVISION-28 §3.7 instalacións", () => {
  const mid = "muni-exemplo";
  let day: string;
  let dayEnd: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 5 });
    day = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 1);
    dayEnd = addDaysIso(day, 2);
    const slots = await getDb()
      .select()
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.unitId, "unit-padel-1"),
          eq(t.timeSlots.date, day),
          eq(t.timeSlots.closed, false),
        ),
      );
    assert.ok(slots[0], "precisa franxa libre");
    await createBooking({
      municipalityId: mid,
      slotId: slots[0]!.id,
      userId: "user-cidada",
      userDisplayName: "Cidadá demo",
    });
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("I4: peche con rango de datas conta reservas en todo o intervalo", async () => {
    const impact = await previewClosureImpact(mid, {
      facilityId: "fac-exemplo-padel",
      startsAt: `${day}T00:00`,
      endsAt: `${dayEnd}T23:59`,
    });
    assert.ok(impact.cancelledCount >= 1);
  });

  it("I6: desactivar instalación — impacto futuro informativo", async () => {
    const impact = await previewFacilityDeactivateImpact(mid, "fac-exemplo-padel");
    assert.ok(impact.cancelledCount >= 1);
    assert.ok(impact.peopleCount >= 1);
  });

  it("I7: createClosureAdmin con rango sen confirmación previa devolve needsConfirm", async () => {
    const r = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-padel",
      startsAt: `${day}T00:00`,
      endsAt: `${dayEnd}T23:59`,
      reason: "obras varios días",
      notifyCitizens: false,
    });
    assert.equal(r.needsConfirm, true);
  });

  it("I9: censo OSM devolve suxestións (Sarreaus 32078)", async () => {
    const rows = await listCensusFacilitySuggestions(mid);
    assert.ok(rows.length >= 1);
    assert.ok(rows.some((r) => r.key.includes("32078") || r.name.includes("OSM")));
  });
});
