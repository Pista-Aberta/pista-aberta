/**
 * REVISION-42 Q9 — reservas dobles / waitlist solape.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r42-q9-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-42-q9";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBooking, modifyBooking } = await import("./db.js");
const {
  addWaitlist,
  acceptWaitlistOffer,
  offerWaitlistOnCancel,
} = await import("./extra.js");
const {
  OverlappingBookingError,
  overlapsSlot,
} = await import("./booking-overlap.js");
const t = await import("../db/schema.js");

const mid = "muni-exemplo";
const ana = "user-cidada";
const brais = "user-brais";
const other = "user-cidada-proba";

function nearDate(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(1, Math.min(6, offsetDays)));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

let slotSeq = 0;

async function insertSlot(opts: {
  unitId: string;
  date: string;
  start: string;
  end: string;
}): Promise<string> {
  slotSeq += 1;
  const id = `slot-q9-${slotSeq}-${Date.now().toString(36)}`;
  await getDb()
    .insert(t.timeSlots)
    .values({
      id,
      unitId: opts.unitId,
      municipalityId: mid,
      date: opts.date,
      start: opts.start,
      end: opts.end,
      closed: false,
    })
    .onConflictDoNothing();
  const hit = await getDb()
    .select()
    .from(t.timeSlots)
    .where(
      and(
        eq(t.timeSlots.unitId, opts.unitId),
        eq(t.timeSlots.date, opts.date),
        eq(t.timeSlots.start, opts.start),
      ),
    )
    .limit(1);
  assert.ok(hit[0], `slot ${opts.unitId} ${opts.date} ${opts.start}`);
  return hit[0]!.id;
}

async function clearUser(userId: string) {
  await getDb()
    .update(t.bookings)
    .set({ status: "cancelled" })
    .where(eq(t.bookings.userId, userId));
  await getDb()
    .update(t.waitlistEntries)
    .set({ status: "expired", offeredUntil: null })
    .where(eq(t.waitlistEntries.userId, userId));
}

before(async () => {
  await initDb();
  await migrateSchema();
  await seedDb();
});

after(async () => {
  await closeDb();
});

describe("REVISION-42 Q9 overlapsSlot", () => {
  it("mesmo día e intervalo solapan", () => {
    assert.equal(
      overlapsSlot("2026-11-10", "19:00", "20:00", "2026-11-10", "19:00", "20:00"),
      true,
    );
    assert.equal(
      overlapsSlot("2026-11-10", "19:00", "20:00", "2026-11-10", "19:30", "20:30"),
      true,
    );
    assert.equal(
      overlapsSlot("2026-11-10", "19:00", "20:00", "2026-11-10", "20:00", "21:00"),
      false,
    );
    assert.equal(
      overlapsSlot("2026-11-10", "19:00", "20:00", "2026-11-11", "19:00", "20:00"),
      false,
    );
  });
});

describe("REVISION-42 Q9a createBooking / modifyBooking", () => {
  it("dúas pistas á mesma hora → 409 overlapping_booking", async () => {
    await clearUser(ana);
    const date = nearDate(2);
    const a = await insertSlot({
      unitId: "unit-padel-1",
      date,
      start: "05:00",
      end: "06:00",
    });
    const b = await insertSlot({
      unitId: "unit-padel-2",
      date,
      start: "05:00",
      end: "06:00",
    });

    await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: ana,
      userDisplayName: "Ana Demo",
      now: new Date(),
    });

    await assert.rejects(
      () =>
        createBooking({
          municipalityId: mid,
          slotId: b,
          userId: ana,
          userDisplayName: "Ana Demo",
          now: new Date(),
        }),
      (err: unknown) => {
        assert.ok(err instanceof OverlappingBookingError);
        assert.equal(err.message, "overlapping_booking");
        assert.ok(err.facilityName);
        assert.equal(err.start, "05:00");
        return true;
      },
    );
  });

  it("familia con outro membro → permitido", async () => {
    await clearUser(ana);
    const date = nearDate(3);
    const a = await insertSlot({
      unitId: "unit-padel-1",
      date,
      start: "05:00",
      end: "06:00",
    });
    const b = await insertSlot({
      unitId: "unit-padel-2",
      date,
      start: "05:00",
      end: "06:00",
    });

    await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: ana,
      userDisplayName: "Ana Demo",
      now: new Date(),
    });

    const fam = await getDb()
      .select()
      .from(t.familyMembers)
      .where(eq(t.familyMembers.userId, ana))
      .limit(1);
    assert.ok(fam[0], "familia seed");

    const forKid = await createBooking({
      municipalityId: mid,
      slotId: b,
      userId: ana,
      userDisplayName: "Ana Demo",
      forMemberId: fam[0]!.id,
      now: new Date(),
    });
    assert.equal(forKid.status, "confirmed");
    assert.equal(forKid.slotId, b);
    const row = await getDb()
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.id, forKid.id))
      .limit(1);
    assert.equal(row[0]?.forMemberId, fam[0]!.id);
  });

  it("cambiar unha reserva a unha hora que se solapa → overlapping_booking", async () => {
    await clearUser(ana);
    const date = nearDate(4);
    const a = await insertSlot({
      unitId: "unit-padel-1",
      date,
      start: "05:00",
      end: "06:00",
    });
    const b = await insertSlot({
      unitId: "unit-padel-1",
      date,
      start: "07:00",
      end: "08:00",
    });
    const c = await insertSlot({
      unitId: "unit-padel-2",
      date,
      start: "05:00",
      end: "06:00",
    });

    const keep = await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: ana,
      userDisplayName: "Ana",
      now: new Date(),
    });
    const move = await createBooking({
      municipalityId: mid,
      slotId: b,
      userId: ana,
      userDisplayName: "Ana",
      now: new Date(),
    });

    await assert.rejects(
      () =>
        modifyBooking({
          bookingId: move.id,
          newSlotId: c,
          userId: ana,
          now: new Date(),
        }),
      (err: unknown) => {
        assert.ok(err instanceof OverlappingBookingError);
        assert.equal(err.bookingId, keep.id);
        return true;
      },
    );
  });

  it("persoal (bookedByStaff) pode solapar", async () => {
    await clearUser(ana);
    const date = nearDate(5);
    const a = await insertSlot({
      unitId: "unit-padel-1",
      date,
      start: "05:00",
      end: "06:00",
    });
    const b = await insertSlot({
      unitId: "unit-padel-2",
      date,
      start: "05:00",
      end: "06:00",
    });
    await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: ana,
      userDisplayName: "Ana",
      now: new Date(),
    });
    const staff = await createBooking({
      municipalityId: mid,
      slotId: b,
      userId: ana,
      userDisplayName: "Ana (proxy)",
      bookedByStaff: true,
      now: new Date(),
    });
    assert.equal(staff.status, "confirmed");
    assert.equal(staff.slotId, b);
  });
});

describe("REVISION-42 Q9b waitlist", () => {
  it("non apuntarse a unha hora con reserva persoal", async () => {
    await clearUser(ana);
    const date = nearDate(2);
    const a = await insertSlot({
      unitId: "unit-padel-1",
      date,
      start: "06:00",
      end: "07:00",
    });
    const b = await insertSlot({
      unitId: "unit-padel-2",
      date,
      start: "06:00",
      end: "07:00",
    });
    await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: ana,
      userDisplayName: "Ana",
      now: new Date(),
    });
    await assert.rejects(
      () =>
        addWaitlist({
          municipalityId: mid,
          slotId: b,
          userId: ana,
          userDisplayName: "Ana",
        }),
      /overlapping_booking/,
    );
  });

  it("dúas ofertas á mesma hora → ao aceptar unha, a outra caduca e pasa á seguinte", async () => {
    await clearUser(ana);
    await clearUser(brais);
    await clearUser(other);
    const date = nearDate(3);
    const slotA = await insertSlot({
      unitId: "unit-padel-1",
      date,
      start: "06:00",
      end: "07:00",
    });
    const slotB = await insertSlot({
      unitId: "unit-padel-2",
      date,
      start: "06:00",
      end: "07:00",
    });

    /* Ocupar ambas franxas (persoas distintas de Ana/Luis). */
    const occA = await createBooking({
      municipalityId: mid,
      slotId: slotA,
      userId: other,
      userDisplayName: "Outra",
      bookedByStaff: true,
      now: new Date(),
    });
    const occB = await createBooking({
      municipalityId: mid,
      slotId: slotB,
      userId: other,
      userDisplayName: "Outra",
      bookedByStaff: true,
      now: new Date(),
    });

    await addWaitlist({
      municipalityId: mid,
      slotId: slotA,
      userId: ana,
      userDisplayName: "Ana",
    });
    await addWaitlist({
      municipalityId: mid,
      slotId: slotB,
      userId: ana,
      userDisplayName: "Ana",
    });
    /* Segunda persoa na cola de B (recibirá a oferta tras caducar a de Ana). */
    await addWaitlist({
      municipalityId: mid,
      slotId: slotB,
      userId: brais,
      userDisplayName: "Luis",
    });

    await getDb()
      .update(t.bookings)
      .set({ status: "cancelled" })
      .where(eq(t.bookings.id, occA.id));
    await getDb()
      .update(t.bookings)
      .set({ status: "cancelled" })
      .where(eq(t.bookings.id, occB.id));

    const offerA = await offerWaitlistOnCancel(slotA, mid);
    const offerB = await offerWaitlistOnCancel(slotB, mid);
    assert.ok(offerA);
    assert.ok(offerB);
    assert.equal(offerA!.userId, ana);
    assert.equal(offerB!.userId, ana);

    const accepted = await acceptWaitlistOffer(
      mid,
      ana,
      "Ana Demo",
      new Date(),
      slotA,
    );
    assert.ok(accepted.bookingId);
    assert.equal(accepted.start, "06:00");
    assert.ok(accepted.facilityName);

    const anaB = await getDb()
      .select()
      .from(t.waitlistEntries)
      .where(
        and(
          eq(t.waitlistEntries.userId, ana),
          eq(t.waitlistEntries.slotId, slotB),
        ),
      )
      .limit(1);
    assert.equal(anaB[0]?.status, "expired");

    const braisOffer = await getDb()
      .select()
      .from(t.waitlistEntries)
      .where(
        and(
          eq(t.waitlistEntries.userId, brais),
          eq(t.waitlistEntries.slotId, slotB),
        ),
      )
      .limit(1);
    assert.equal(braisOffer[0]?.status, "offered");
  });
});
