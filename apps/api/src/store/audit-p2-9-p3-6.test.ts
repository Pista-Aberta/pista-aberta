import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ne } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-audit-p2-9-p3-6-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "audit-p2-9-p3-6-secret";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createSeason, updateSeason } = await import("./seasons.js");
const { createBooking, applyToActivity } = await import("./db.js");
const { addDaysIso, localDateIso, DEFAULT_TIMEZONE } = await import(
  "./business-rules.js"
);
const {
  seasonCreateBodySchema,
  seasonErrorStatus,
  seasonUpdateBodySchema,
} = await import("../routes/complete.js");

const municipalityId = "muni-exemplo";

describe("audit P2.9 e P3.6", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("P2.9: os bodies de tempada son estritos e validan datas reais e orde", () => {
    assert.equal(
      seasonCreateBodySchema.safeParse({
        name: "Inválida",
        startsAt: "2027-02-29",
        endsAt: "2027-03-01",
      }).success,
      false,
    );
    assert.equal(
      seasonCreateBodySchema.safeParse({
        name: "Invertida",
        startsAt: "2027-06-30",
        endsAt: "2027-06-01",
      }).success,
      false,
    );
    assert.equal(
      seasonUpdateBodySchema.safeParse({ published: true, unexpected: true })
        .success,
      false,
    );
    assert.equal(seasonErrorStatus("invalid_dates"), 400);
    assert.equal(seasonErrorStatus("dates_inverted"), 400);
    assert.equal(seasonErrorStatus("not_found"), 404);
    assert.equal(seasonErrorStatus("facility_not_found"), 404);
  });

  it("P2.9: o store rexeita datas inválidas/invertidas e instalacións alleas", async () => {
    const base = {
      municipalityId,
      name: "Auditoría",
      facilityIds: [] as string[],
      criteriaGl: "",
      criteriaEs: "",
      published: false,
      actor: "test",
    };
    await assert.rejects(
      () =>
        createSeason({
          ...base,
          startsAt: "2027-02-29",
          endsAt: "2027-03-01",
        }),
      /invalid_dates/,
    );
    await assert.rejects(
      () =>
        createSeason({
          ...base,
          startsAt: "2027-07-01",
          endsAt: "2027-06-01",
        }),
      /dates_inverted/,
    );

    const foreign = (
      await getDb()
        .select({ id: t.facilities.id })
        .from(t.facilities)
        .where(ne(t.facilities.municipalityId, municipalityId))
        .limit(1)
    )[0];
    assert.ok(foreign);
    await assert.rejects(
      () =>
        createSeason({
          ...base,
          startsAt: "2027-06-01",
          endsAt: "2027-07-01",
          facilityIds: [foreign.id],
        }),
      /facility_not_found/,
    );
    await assert.rejects(
      () =>
        updateSeason(municipalityId, "season-does-not-exist", {
          published: true,
          actor: "test",
        }),
      /not_found/,
    );
  });

  it("P3.6: un familiar da conta úsase noutro concello en reservas e actividades", async () => {
    const memberId = "fam-global-audit";
    await getDb().insert(t.familyMembers).values({
      id: memberId,
      userId: "user-cidada",
      municipalityId: "muni-proba",
      displayName: "Lúa Riveira",
      birthYear: 2015,
      relation: "filla",
    });

    const date = addDaysIso(
      localDateIso(new Date(), DEFAULT_TIMEZONE),
      1,
    );
    const slotId = "slot-family-global-audit";
    await getDb().insert(t.timeSlots).values({
      id: slotId,
      municipalityId,
      unitId: "unit-padel-1",
      date,
      start: "12:17",
      end: "13:17",
      closed: false,
    });
    const booking = await createBooking({
      municipalityId,
      slotId,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
      forMemberId: memberId,
    });
    assert.equal(booking.userId, "user-cidada");

    const activityId = "activity-family-global-audit";
    await getDb().insert(t.activities).values({
      id: activityId,
      municipalityId,
      facilityId: "fac-exemplo-padel",
      name: "Actividade familiar global",
      description: "Test",
      days: "Luns",
      hours: "12:00",
      places: 10,
      ageMin: 0,
      ageMax: 99,
      method: "first_come",
      deadline: addDaysIso(date, 5),
      lotteryStatus: "open",
    });
    const application = await applyToActivity({
      activityId,
      municipalityId,
      userId: "user-cidada",
      forMemberId: memberId,
    });
    assert.equal(application.forMemberId, memberId);
    assert.equal(application.forMemberName, "Lúa Riveira");
  });

  it("P3.6: coñecer o id dun familiar doutra conta non dá acceso", async () => {
    const foreignMemberId = "fam-other-account-audit";
    await getDb().insert(t.familyMembers).values({
      id: foreignMemberId,
      userId: "user-admin",
      municipalityId,
      displayName: "Familiar alleo",
      birthYear: 2015,
      relation: "dependente",
    });

    const activityId = "activity-family-global-audit";
    await assert.rejects(
      () =>
        applyToActivity({
          activityId,
          municipalityId,
          userId: "user-cidada",
          forMemberId: foreignMemberId,
        }),
      /family_member_forbidden/,
    );

    const date = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 2);
    const slotId = "slot-family-foreign-account-audit";
    await getDb().insert(t.timeSlots).values({
      id: slotId,
      municipalityId,
      unitId: "unit-padel-1",
      date,
      start: "14:17",
      end: "15:17",
      closed: false,
    });
    await assert.rejects(
      () =>
        createBooking({
          municipalityId,
          slotId,
          userId: "user-cidada",
          userDisplayName: "Ana Demo",
          forMemberId: foreignMemberId,
        }),
      /family_member_forbidden/,
    );
  });
});
