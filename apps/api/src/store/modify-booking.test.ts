/**
 * REVISION-9 §3.2 — modificación atómica de reserva.
 * REVISION-29 Y1: franxas propias (horas fóra do seed), sen depender da data do calendario.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-mod-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-modify-booking";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBooking, modifyBooking } = await import("./db.js");
const { addWaitlist, offerWaitlistOnCancel } = await import("./extra.js");
const t = await import("../db/schema.js");

const mid = "muni-exemplo";
const unitId = "unit-padel-1";

/** Data dentro da antelación (7 días), independente do día da semana. */
function nearDate(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(1, Math.min(6, offsetDays)));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const bookNow = () => new Date();

let slotSeq = 0;

async function insertOwnSlot(opts: {
  date: string;
  start: string;
  end: string;
}): Promise<string> {
  slotSeq += 1;
  const id = `slot-mod-y1-${slotSeq}-${Date.now().toString(36)}`;
  await getDb()
    .insert(t.timeSlots)
    .values({
      id,
      unitId,
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
        eq(t.timeSlots.unitId, unitId),
        eq(t.timeSlots.date, opts.date),
        eq(t.timeSlots.start, opts.start),
      ),
    )
    .limit(1);
  assert.ok(hit[0], `slot ${opts.date} ${opts.start}`);
  return hit[0]!.id;
}

async function clearAna() {
  await getDb()
    .update(t.bookings)
    .set({ status: "cancelled" })
    .where(eq(t.bookings.userId, "user-cidada"));
}

before(async () => {
  await initDb();
  await migrateSchema();
  await seedDb();
});

after(async () => {
  await closeDb();
});

describe("modifyBooking (REVISION-9 §3.2)", () => {
  it("cambia á franxa nova mantendo código+QR e SEQUENCE+1", async () => {
    await clearAna();
    const date = nearDate(2);
    /* Horas fóra do seed (09–13 / 16–22). */
    const a = await insertOwnSlot({ date, start: "03:00", end: "04:00" });
    const b = await insertOwnSlot({ date, start: "03:30", end: "04:30" });

    const booking = await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
      now: bookNow(),
    });
    const code = booking.shortCode;
    const qr = booking.qrPayload;

    const { booking: updated } = await modifyBooking({
      bookingId: booking.id,
      newSlotId: b,
      userId: "user-cidada",
      now: bookNow(),
    });

    assert.equal(updated.id, booking.id);
    assert.equal(updated.shortCode, code);
    assert.equal(updated.qrPayload, qr);
    assert.equal(updated.slotId, b);
    assert.equal(updated.start, "03:30");
    assert.equal(updated.icsSequence, 1);
  });

  it("hora ocupada → slot_occupied", async () => {
    await clearAna();
    const date = nearDate(3);
    /* REVISION-50 A1: franxas sen solape ao crear; o destino da modify está ocupado. */
    const a = await insertOwnSlot({ date, start: "03:00", end: "04:00" });
    const b = await insertOwnSlot({ date, start: "05:00", end: "06:00" });

    const one = await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: "user-cidada",
      userDisplayName: "Ana",
      now: bookNow(),
    });
    await createBooking({
      municipalityId: mid,
      slotId: b,
      userId: "demo-citizen-1",
      userDisplayName: "Outra",
      now: bookNow(),
    });

    await assert.rejects(
      () =>
        modifyBooking({
          bookingId: one.id,
          newSlotId: b,
          userId: "user-cidada",
          now: bookNow(),
        }),
      /slot_occupied/,
    );
  });

  it("REVISION-28 X6: mesma franxa → same_slot", async () => {
    await clearAna();
    const date = nearDate(4);
    const a = await insertOwnSlot({ date, start: "04:00", end: "05:00" });
    const booking = await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: "user-cidada",
      userDisplayName: "Ana",
      now: bookNow(),
    });
    await assert.rejects(
      () =>
        modifyBooking({
          bookingId: booking.id,
          newSlotId: a,
          userId: "user-cidada",
          now: bookNow(),
        }),
      /same_slot/,
    );
  });

  it("outra persoa → forbidden", async () => {
    await clearAna();
    const date = nearDate(5);
    const a = await insertOwnSlot({ date, start: "03:00", end: "04:00" });
    const b = await insertOwnSlot({ date, start: "03:30", end: "04:30" });
    const booking = await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: "user-cidada",
      userDisplayName: "Ana",
      now: bookNow(),
    });
    await assert.rejects(
      () =>
        modifyBooking({
          bookingId: booking.id,
          newSlotId: b,
          userId: "demo-citizen-2",
          now: bookNow(),
        }),
      /forbidden/,
    );
  });

  it("fóra do prazo → modify_too_late", async () => {
    await clearAna();
    const date = nearDate(1);
    const a = await insertOwnSlot({ date, start: "05:00", end: "06:00" });
    const b = await insertOwnSlot({ date, start: "05:30", end: "06:30" });
    const booking = await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: "user-cidada",
      userDisplayName: "Ana",
      now: bookNow(),
    });
    /* 30 min antes do inicio (CET: 05:00 Madrid = 03:00/04:00 UTC). */
    await assert.rejects(
      () =>
        modifyBooking({
          bookingId: booking.id,
          newSlotId: b,
          userId: "user-cidada",
          now: new Date(`${date}T03:30:00.000Z`),
        }),
      /modify_too_late/,
    );
  });

  it("lista de espera recibe a franxa liberada", async () => {
    await clearAna();
    const date = nearDate(6);
    const a = await insertOwnSlot({ date, start: "06:00", end: "07:00" });
    const b = await insertOwnSlot({ date, start: "06:30", end: "07:30" });

    const booking = await createBooking({
      municipalityId: mid,
      slotId: a,
      userId: "user-cidada",
      userDisplayName: "Ana",
      now: bookNow(),
    });
    await addWaitlist({
      municipalityId: mid,
      slotId: a,
      userId: "user-brais",
      userDisplayName: "Luis Demo",
    });

    const { previousSlotId } = await modifyBooking({
      bookingId: booking.id,
      newSlotId: b,
      userId: "user-cidada",
      now: bookNow(),
    });
    assert.equal(previousSlotId, a);
    await offerWaitlistOnCancel(a, mid);

    const entries = await getDb()
      .select()
      .from(t.waitlistEntries)
      .where(eq(t.waitlistEntries.slotId, a));
    const brais = entries.find((e) => e.userId === "user-brais");
    assert.equal(brais?.status, "offered");
  });
});
