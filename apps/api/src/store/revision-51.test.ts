/**
 * REVISION-51 — B1/B2/B3 + C1.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev51-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
delete process.env.AUTH_ELEVATED_SAML_ONLY;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createBooking, applyToActivity } = await import("./db.js");
const { listFreeHoursForMatch, moveMatch } = await import("./admin-ops.js");
const {
  assertEmailChangeRateLimit,
  LoginRateLimitedError,
} = await import("../identity/login-rate-limit.js");
const {
  addDaysIso,
  futureWeekendSaturdayIso,
  localDateIso,
  DEFAULT_TIMEZONE,
} = await import("./business-rules.js");

const mid = "muni-exemplo";

function nearDate(offset: number): string {
  return addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), offset);
}

async function freeSlot(unitId: string, date: string, start: string) {
  const endH = Number(start.slice(0, 2)) + 1;
  const end = `${String(endH).padStart(2, "0")}:00`;
  const id = `slot-${unitId}-${date}-${start.replace(":", "")}-r51`;
  await getDb()
    .insert(t.timeSlots)
    .values({
      id,
      unitId,
      municipalityId: mid,
      date,
      start,
      end,
      closed: false,
    })
    .onConflictDoNothing();
  const existing = await getDb()
    .select()
    .from(t.timeSlots)
    .where(
      and(
        eq(t.timeSlots.unitId, unitId),
        eq(t.timeSlots.date, date),
        eq(t.timeSlots.start, start),
        eq(t.timeSlots.municipalityId, mid),
      ),
    )
    .limit(1);
  const slotId = existing[0]?.id ?? id;
  await getDb()
    .update(t.bookings)
    .set({ status: "cancelled" })
    .where(
      and(eq(t.bookings.slotId, slotId), eq(t.bookings.municipalityId, mid)),
    );
  await getDb()
    .update(t.timeSlots)
    .set({ closed: false, heldForUserId: null, heldUntil: null })
    .where(eq(t.timeSlots.id, slotId));
  return slotId;
}

describe("REVISION-51 B1 B2 B3 C1", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const m8 = (
      await getDb().select().from(t.matches).where(eq(t.matches.id, "m8")).limit(1)
    )[0];
    if (m8 && m8.date <= today) {
      const nextSat = futureWeekendSaturdayIso(new Date(), DEFAULT_TIMEZONE);
      await getDb()
        .update(t.matches)
        .set({ date: nextSat })
        .where(eq(t.matches.id, "m8"));
    }
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("B1: suxestións non inclúen hora dunha reserva activa", async () => {
    /* Sábado próximo da fin de semana do partido m8 (ou crear reserva no mesmo día). */
    const match = (
      await getDb().select().from(t.matches).where(eq(t.matches.id, "m8")).limit(1)
    )[0];
    assert.ok(match);
    const date = match.date;
    const slotId = await freeSlot("unit-pav-full", date, "16:00");
    await createBooking({
      municipalityId: mid,
      slotId,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
    });
    const free = await listFreeHoursForMatch(mid, "m8", {
      unitId: "unit-pav-full",
      facilityId: "fac-exemplo-pav",
    });
    assert.ok(
      !free.some((s) => s.date === date && s.start === "16:00"),
      `16:00 non debe suxerirse: ${JSON.stringify(free)}`,
    );
  });

  it("B2: conflito de mover amosa nomes sen ids", async () => {
    const match = (
      await getDb().select().from(t.matches).where(eq(t.matches.id, "m8")).limit(1)
    )[0];
    assert.ok(match);
    const date = match.date;
    const slotId = await freeSlot("unit-pav-full", date, "17:00");
    await createBooking({
      municipalityId: mid,
      slotId,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
    });
    await assert.rejects(
      () =>
        moveMatch(
          mid,
          "m8",
          {
            date,
            start: "17:00",
            end: "18:30",
            unitId: "unit-pav-full",
            facilityId: "fac-exemplo-pav",
          },
          "test",
        ),
      (e: unknown) => {
        if (!(e instanceof Error) || e.message !== "conflict") return false;
        const conflicts = (
          e as Error & { conflicts?: Array<{ kind: string; detail: string }> }
        ).conflicts;
        const booking = conflicts?.find((c) => c.kind === "booking_overlap");
        if (!booking) return false;
        assert.match(booking.detail, /Reserva de Ana D\./);
        assert.match(booking.detail, /17:00–18:00|17:00-18:00/);
        assert.doesNotMatch(booking.detail, /unit-pav/);
        assert.doesNotMatch(booking.detail, /user-cidada/);
        return true;
      },
    );
  });

  it("B3: límite cambio correo 5/hora/persoa e 3/destino", async () => {
    const userId = `u-r51-${Date.now()}`;
    const destA = `dest-a-${Date.now()}@proba.gal`;
    for (let i = 0; i < 5; i++) {
      await assertEmailChangeRateLimit(userId, `${i}-${destA}`);
    }
    await assert.rejects(
      () => assertEmailChangeRateLimit(userId, `x-${destA}`),
      (e: unknown) => e instanceof LoginRateLimitedError,
    );
    const destB = `dest-b-${Date.now()}@proba.gal`;
    const other = `u-r51-other-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await assertEmailChangeRateLimit(`${other}-${i}`, destB);
    }
    await assert.rejects(
      () => assertEmailChangeRateLimit(`${other}-x`, destB),
      (e: unknown) => e instanceof LoginRateLimitedError,
    );
  });

  it("C1: 403 familiar alleo, 400 idade, OK dous fillos", async () => {
    /* Abrir actividade first_come para inscricións. */
    await getDb()
      .update(t.activities)
      .set({ lotteryStatus: "open" })
      .where(eq(t.activities.id, "act-padel-iniciacion"));

    await assert.rejects(
      () =>
        applyToActivity({
          activityId: "act-padel-iniciacion",
          municipalityId: mid,
          userId: "user-cidada",
          forMemberId: "fam-alleo-non-exists",
        }),
      /family_member_forbidden/,
    );

    /* Multideporte 6–12: Luis 2019 pode ter 6–7; forzar idade fóra. */
    await getDb()
      .update(t.activities)
      .set({ lotteryStatus: "open", ageMin: 10, ageMax: 12 })
      .where(eq(t.activities.id, "act-basquet-escola"));
    await assert.rejects(
      () =>
        applyToActivity({
          activityId: "act-basquet-escola",
          municipalityId: mid,
          userId: "user-cidada",
          forMemberId: "fam-2", /* Luis 2019 → ~7 */
        }),
      /age_out_of_range/,
    );

    await getDb()
      .update(t.activities)
      .set({ lotteryStatus: "open", ageMin: 6, ageMax: 14 })
      .where(eq(t.activities.id, "act-basquet-escola"));
    /* Limpar inscricións previas de Ana nesta actividade. */
    await getDb()
      .delete(t.activityApplications)
      .where(
        and(
          eq(t.activityApplications.activityId, "act-basquet-escola"),
          eq(t.activityApplications.userId, "user-cidada"),
        ),
      );
    const a1 = await applyToActivity({
      activityId: "act-basquet-escola",
      municipalityId: mid,
      userId: "user-cidada",
      forMemberId: "fam-1",
    });
    const a2 = await applyToActivity({
      activityId: "act-basquet-escola",
      municipalityId: mid,
      userId: "user-cidada",
      forMemberId: "fam-2",
    });
    assert.equal(a1.forMemberId, "fam-1");
    assert.equal(a2.forMemberId, "fam-2");
    assert.ok(a1.applicationNumber);
    assert.ok(a2.applicationNumber);
  });
});
