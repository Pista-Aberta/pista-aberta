/**
 * REVISION-58 K1 — grupo fixo na pista completa pecha tamén medias A e B.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev58-k1-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createFixedGroup, deactivateFixedGroup } = await import(
  "./fixed-groups.js"
);
const { ensureSlotsAhead, regenerateSlotsForUnitAhead } = await import(
  "./slots-ahead.js"
);
const { createClosureAdmin, deleteClosureAdmin } = await import(
  "./admin-ops.js"
);
const { addDaysIso, localDateIso, localWeekday, DEFAULT_TIMEZONE } =
  await import("./business-rules.js");

describe("REVISION-58 K1 incompatibles", () => {
  const mid = "muni-exemplo";
  let tuesday: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 21 });
    for (const uid of ["unit-pav-full", "unit-pav-a", "unit-pav-b"]) {
      await regenerateSlotsForUnitAhead(mid, uid, { days: 28 });
    }
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    let d = today;
    for (let i = 0; i < 14; i++) {
      if (localWeekday(d, DEFAULT_TIMEZONE) === 2 && d > today) {
        tuesday = d;
        break;
      }
      d = addDaysIso(d, 1);
    }
    assert.ok(tuesday, "hai un martes futuro");
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function slotClosed(unitId: string, date: string, start: string) {
    return (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, unitId),
            eq(t.timeSlots.date, date),
            eq(t.timeSlots.start, start),
          ),
        )
        .limit(1)
    )[0];
  }

  it("K1: grupo en unit-pav-full pecha tamén unit-pav-a e unit-pav-b", async () => {
    const g = await createFixedGroup(mid, "test", {
      name: "Grupo pavillón completo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      weekday: 2,
      start: "16:00",
      end: "17:00",
      validFrom: tuesday,
      validTo: addDaysIso(tuesday, 28),
    });
    assert.equal(g.needsConfirm, false);
    if (g.needsConfirm) throw new Error("unexpected needsConfirm");

    const full = await slotClosed("unit-pav-full", tuesday, "16:00");
    const a = await slotClosed("unit-pav-a", tuesday, "16:00");
    const b = await slotClosed("unit-pav-b", tuesday, "16:00");
    assert.equal(full?.closed, true);
    assert.equal(full?.closedReason, "grupo_fixo");
    assert.equal(a?.closed, true, "media A debe pecharse");
    assert.equal(a?.closedReason, "grupo_fixo");
    assert.equal(b?.closed, true, "media B debe pecharse");
    assert.equal(b?.closedReason, "grupo_fixo");

    await deactivateFixedGroup(mid, g.id, "test");
    const fullOpen = await slotClosed("unit-pav-full", tuesday, "16:00");
    const aOpen = await slotClosed("unit-pav-a", tuesday, "16:00");
    const bOpen = await slotClosed("unit-pav-b", tuesday, "16:00");
    assert.equal(fullOpen?.closed, false);
    assert.equal(aOpen?.closed, false);
    assert.equal(bOpen?.closed, false);
  });

  it("K1: borrar peche dunha unidade rexenera incompatibles", async () => {
    const date = addDaysIso(tuesday, 7);
    assert.equal(localWeekday(date, DEFAULT_TIMEZONE), 2);

    /* Grupo na completa: pecha full+A+B. */
    await createFixedGroup(mid, "test", {
      name: "Grupo para peche",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      weekday: 2,
      start: "18:00",
      end: "19:00",
      validFrom: date,
      validTo: addDaysIso(date, 14),
    });
    assert.equal((await slotClosed("unit-pav-a", date, "18:00"))?.closed, true);

    const created = await createClosureAdmin(mid, "test", {
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      startsAt: `${date}T10:00`,
      endsAt: `${date}T11:00`,
      reason: "K1 peche full",
      confirm: true,
    });
    assert.equal(created.needsConfirm, false);
    if (created.needsConfirm) throw new Error("unexpected needsConfirm");
    const closureId = created.id ?? created.ids?.[0];
    assert.ok(closureId);

    /* Estado obsoleto: media A aberta; borrar peche chama regenerateUnitsAfterClosure. */
    await getDb()
      .update(t.timeSlots)
      .set({ closed: false, closedReason: null })
      .where(
        and(
          eq(t.timeSlots.unitId, "unit-pav-a"),
          eq(t.timeSlots.date, date),
          eq(t.timeSlots.start, "18:00"),
        ),
      );

    await deleteClosureAdmin(mid, closureId, "test");

    const aAfter = await slotClosed("unit-pav-a", date, "18:00");
    assert.equal(aAfter?.closed, true, "rexenerar incompatibles restaura o bloqueo");
  });
});
