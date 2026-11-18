/**
 * REVISION-58 K3 — seasonId/validTo ao aprobar e retirar franxa.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev58-k3-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const {
  approveClubRequest,
  createClubRequest,
} = await import("./admin-ops.js");
const { createSeason, deleteSeason, deleteSeasonSlot, updateSeason } =
  await import("./seasons.js");
const { ensureSlotsAhead, regenerateSlotsForUnitAhead } = await import(
  "./slots-ahead.js"
);
const { addDaysIso, localDateIso, localWeekday, DEFAULT_TIMEZONE } =
  await import("./business-rules.js");
const { newId } = await import("../lib/ids.js");

describe("REVISION-58 K3 tempada club", () => {
  const mid = "muni-exemplo";
  let monday: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 21 });
    await regenerateSlotsForUnitAhead(mid, "unit-padel-1", { days: 28 });
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    let d = today;
    for (let i = 0; i < 14; i++) {
      if (localWeekday(d, DEFAULT_TIMEZONE) === 1 && d > today) {
        monday = d;
        break;
      }
      d = addDaysIso(d, 1);
    }
    assert.ok(monday);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("K3: aprobar con campaña garda seasonId; sen campaña garda validTo", async () => {
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const season = await createSeason({
      municipalityId: mid,
      name: "Campaña K3",
      startsAt: addDaysIso(today, -7),
      endsAt: addDaysIso(today, 60),
      facilityIds: ["fac-exemplo-padel"],
      criteriaGl: "",
      criteriaEs: "",
      published: true,
      actor: "test",
    });

    const req = await createClubRequest({
      municipalityId: mid,
      clubId: "club-basquet",
      type: "season",
      payload: {
        facilityId: "fac-exemplo-padel",
        unitId: "unit-padel-1",
        weekday: 1,
        start: "11:00",
        end: "12:00",
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });
    await approveClubRequest(mid, req.id, "test-admin");

    const withSeason = (
      await getDb()
        .select()
        .from(t.seasonSlots)
        .where(
          and(
            eq(t.seasonSlots.unitId, "unit-padel-1"),
            eq(t.seasonSlots.start, "11:00"),
            eq(t.seasonSlots.end, "12:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(withSeason);
    assert.equal(withSeason.seasonId, season.id);
    assert.equal(withSeason.validTo, null);

    /* Despublicar a campaña do pádel → seguinte aprobación sen cobertura. */
    await updateSeason(mid, season.id, { published: false, actor: "test" });

    const req2 = await createClubRequest({
      municipalityId: mid,
      clubId: "club-basquet",
      type: "season",
      payload: {
        facilityId: "fac-exemplo-padel",
        unitId: "unit-padel-1",
        weekday: 1,
        start: "12:00",
        end: "13:00",
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });
    await approveClubRequest(mid, req2.id, "test-admin");
    const withValidTo = (
      await getDb()
        .select()
        .from(t.seasonSlots)
        .where(
          and(
            eq(t.seasonSlots.unitId, "unit-padel-1"),
            eq(t.seasonSlots.start, "12:00"),
            eq(t.seasonSlots.end, "13:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(withValidTo);
    assert.equal(withValidTo.seasonId, null);
    assert.ok(withValidTo.validTo);
    assert.match(withValidTo.validTo!, /^\d{4}-06-30$/);
  });

  it("K3: validTo limita o bloqueo; retirar franxa reabre", async () => {
    const shortTo = addDaysIso(monday, 7);
    const slotId = newId("ss");
    await getDb().insert(t.seasonSlots).values({
      id: slotId,
      municipalityId: mid,
      clubId: "club-basquet",
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      weekday: 1,
      start: "10:00",
      end: "11:00",
      priority: 1,
      seasonId: null,
      validTo: shortTo,
    });
    await regenerateSlotsForUnitAhead(mid, "unit-padel-1", { days: 28 });

    const inside = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, monday),
            eq(t.timeSlots.start, "10:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(inside?.closed, true);

    const outsideDate = addDaysIso(monday, 14);
    assert.equal(localWeekday(outsideDate, DEFAULT_TIMEZONE), 1);
    assert.ok(outsideDate > shortTo);
    const outside = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, outsideDate),
            eq(t.timeSlots.start, "10:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(outside);
    assert.equal(outside.closed, false, "fóra de validTo non bloquea");

    await deleteSeasonSlot(mid, slotId, "test");
    const after = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, monday),
            eq(t.timeSlots.start, "10:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(after?.closed, false);
  });

  it("P1.3: borrar campaña elimina as súas franxas e reabre sen perder reservas", async () => {
    const season = await createSeason({
      municipalityId: mid,
      name: "Campaña para borrar",
      startsAt: addDaysIso(monday, -1),
      endsAt: addDaysIso(monday, 30),
      facilityIds: ["fac-exemplo-padel"],
      criteriaGl: "",
      criteriaEs: "",
      published: true,
      actor: "test",
    });
    const seasonSlotId = newId("ss");
    await getDb().insert(t.seasonSlots).values({
      id: seasonSlotId,
      municipalityId: mid,
      clubId: "club-basquet",
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      weekday: 1,
      start: "09:00",
      end: "10:00",
      priority: 1,
      seasonId: season.id,
      validTo: null,
    });
    await regenerateSlotsForUnitAhead(mid, "unit-padel-1", { days: 28 });

    const bookedSlot = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, monday),
            eq(t.timeSlots.start, "09:00"),
          ),
        )
        .limit(1)
    )[0];
    const reopenedDate = addDaysIso(monday, 7);
    const slotToReopen = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-padel-1"),
            eq(t.timeSlots.date, reopenedDate),
            eq(t.timeSlots.start, "09:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.equal(bookedSlot?.closed, true);
    assert.equal(slotToReopen?.closed, true);

    const bookingId = newId("book");
    await getDb().insert(t.bookings).values({
      id: bookingId,
      municipalityId: mid,
      unitId: "unit-padel-1",
      facilityId: "fac-exemplo-padel",
      userId: "user-cidada",
      userDisplayName: "Reserva válida",
      slotId: bookedSlot!.id,
      date: monday,
      start: "09:00",
      end: "10:00",
      status: "confirmed",
      shortCode: "P13TST",
      qrPayload: `pa:p13:${bookingId}`,
    });

    await deleteSeason(mid, season.id, "test-admin");

    const linkedSlots = await getDb()
      .select()
      .from(t.seasonSlots)
      .where(eq(t.seasonSlots.seasonId, season.id));
    assert.equal(linkedSlots.length, 0, "non deixa bloqueos desligados");

    const reopened = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(eq(t.timeSlots.id, slotToReopen!.id))
        .limit(1)
    )[0];
    assert.equal(reopened?.closed, false, "a seguinte ocorrencia volve estar libre");

    const booking = (
      await getDb()
        .select()
        .from(t.bookings)
        .where(eq(t.bookings.id, bookingId))
        .limit(1)
    )[0];
    assert.equal(booking?.status, "confirmed", "conserva a reserva válida");
  });
});
