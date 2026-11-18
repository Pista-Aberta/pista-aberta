/**
 * Un test por fallo das regras de negocio (revisión Pablo).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-negocio-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  createBooking,
  cancelBooking,
  checkInByQr,
  applyToActivity,
  listSlots,
  anonymizePastBookings,
} = await import("./db.js");
const {
  clientSentPriorityGroup,
  QR_CHECKIN_MARGIN_MINUTES,
  addDaysIso,
  todayIso,
  slotDateTime,
} = await import("./business-rules.js");
const t = await import("../db/schema.js");

async function insertSlot(opts: {
  id: string;
  unitId: string;
  municipalityId: string;
  date: string;
  start: string;
  end: string;
}) {
  await getDb().insert(t.timeSlots).values({
    id: opts.id,
    unitId: opts.unitId,
    municipalityId: opts.municipalityId,
    date: opts.date,
    start: opts.start,
    end: opts.end,
    closed: false,
    closedReason: null,
  });
}

async function futureFreeSlots(n: number) {
  const slots = await listSlots({
    municipalityId: "muni-exemplo",
    facilityId: "fac-exemplo-padel",
  });
  const now = new Date();
  /* cancelMinHours=2: franxas a máis de 2 h para poder cancelar no limpeza do test. */
  const minCancelMs = 2 * 3_600_000;
  const free = slots.filter((s) => {
    if (s.occupied || s.closed) return false;
    return slotDateTime(s.date, s.start).getTime() - now.getTime() > minCancelMs;
  });
  /* Sen solape persoal: unha franxa por (date,start) — se non, o 4º
   * choque con overlapping_booking antes de booking_limit_exceeded. */
  const out: typeof free = [];
  const seen = new Set<string>();
  for (const s of free) {
    const key = `${s.date}|${s.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

describe("regras de negocio (PGlite)", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rexeita franxa pasada (slot_in_past)", async () => {
    const yesterday = addDaysIso(todayIso(), -1);
    const id = `slot-past-${randomUUID().slice(0, 8)}`;
    await insertSlot({
      id,
      unitId: "unit-padel-1",
      municipalityId: "muni-exemplo",
      date: yesterday,
      // Fora das franxas da semente (quiet hours 09–12 / 16–21)
      start: "05:00",
      end: "06:00",
    });
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: "muni-exemplo",
          slotId: id,
          userId: "user-cidada",
          userDisplayName: "Ana",
        }),
      /slot_in_past/,
    );
  });

  it("aplica bookingAntelationDays (antelation_exceeded)", async () => {
    const far = addDaysIso(todayIso(), 8); // antelación seed: 7 días
    const id = `slot-far-${randomUUID().slice(0, 8)}`;
    // Hora fóra do seed rodante (agora ata 22:00) para non chocar co unique
    await insertSlot({
      id,
      unitId: "unit-padel-1",
      municipalityId: "muni-exemplo",
      date: far,
      start: "22:00",
      end: "23:00",
    });
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: "muni-exemplo",
          slotId: id,
          userId: "user-cidada",
          userDisplayName: "Ana",
        }),
      /antelation_exceeded/,
    );
  });

  it("limita reservas activas (booking_limit_exceeded)", async () => {
    const free = await futureFreeSlots(4);
    assert.ok(free.length >= 4, "fan falta franxas futuras libres");
    const made = [];
    for (let i = 0; i < 3; i++) {
      made.push(
        await createBooking({
          municipalityId: "muni-exemplo",
          slotId: free[i]!.id,
          userId: "user-limit-test",
          userDisplayName: "Limite",
        }),
      );
    }
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: "muni-exemplo",
          slotId: free[3]!.id,
          userId: "user-limit-test",
          userDisplayName: "Limite",
        }),
      /booking_limit_exceeded/,
    );
    for (const b of made) await cancelBooking(b.id, "user-limit-test");
  });

  it("unha inscrición por (user, activity) — already_applied", async () => {
    const first = await applyToActivity({
      activityId: "act-ex-yoga",
      municipalityId: "muni-proba",
      userId: "user-dup-apply",
    });
    assert.equal(first.priorityGroup, "sorteo");
    assert.match(first.applicationNumber, /^req-\d{4}$/);
    await assert.rejects(
      () =>
        applyToActivity({
          activityId: "act-ex-yoga",
          municipalityId: "muni-proba",
          userId: "user-dup-apply",
        }),
      /already_applied/,
    );
  });

  it("priorityGroup do cliente está prohibido", () => {
    assert.equal(clientSentPriorityGroup({ priorityGroup: "renovacion" }), true);
    assert.equal(clientSentPriorityGroup({ priorityGroup: "sorteo" }), true);
    assert.equal(clientSentPriorityGroup({}), false);
    assert.equal(clientSentPriorityGroup(null), false);
  });

  it("QR: rexeita reutilización (xa_rexistrado)", async () => {
    const free = await futureFreeSlots(1);
    assert.ok(free[0]);
    const slot = free[0]!;
    // Forzar «agora» dentro da ventá da franxa
    const now = new Date(slotDateTime(slot.date, slot.start).getTime() + 5 * 60_000);
    /* REVISION-44 S1: start <= agora é pasada → reservar 1 min antes. */
    const bookAt = new Date(slotDateTime(slot.date, slot.start).getTime() - 60_000);
    const b = await createBooking({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-qr-reuse",
      userDisplayName: "QR",
      now: bookAt,
      bookedByStaff: true, // non contar no límite do cidadán
    });
    const ok = await checkInByQr(b.qrPayload, "muni-exemplo", now);
    assert.equal(ok.valid, true);
    const again = await checkInByQr(b.qrPayload, "muni-exemplo", now);
    assert.equal(again.valid, false);
    assert.equal(again.reason, "xa_rexistrado");
    await cancelBooking(b.id, "user-qr-reuse", true);
  });

  it("QR: rexeita fóra da ventá horaria (±30 min)", async () => {
    const free = await futureFreeSlots(1);
    assert.ok(free[0]);
    const slot = free[0]!;
    const bookAt = new Date(slotDateTime(slot.date, slot.start).getTime() - 60_000);
    const b = await createBooking({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-qr-window",
      userDisplayName: "QR",
      now: bookAt,
      bookedByStaff: true,
    });
    const tooEarly = new Date(
      slotDateTime(slot.date, slot.start).getTime() -
        (QR_CHECKIN_MARGIN_MINUTES + 5) * 60_000,
    );
    const r = await checkInByQr(b.qrPayload, "muni-exemplo", tooEarly);
    assert.equal(r.valid, false);
    assert.equal(r.reason, "fora_de_ventan");
    await cancelBooking(b.id, "user-qr-window", true);
  });

  it("doble reserva concurrente na mesma franxa → unha falla", async () => {
    const free = await futureFreeSlots(1);
    assert.ok(free[0]);
    const slotId = free[0]!.id;
    const results = await Promise.allSettled([
      createBooking({
        municipalityId: "muni-exemplo",
        slotId,
        userId: "user-race-a",
        userDisplayName: "A",
        bookedByStaff: true,
      }),
      createBooking({
        municipalityId: "muni-exemplo",
        slotId,
        userId: "user-race-b",
        userDisplayName: "B",
        bookedByStaff: true,
      }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(fail.length, 1);
    assert.match(String((fail[0] as PromiseRejectedResult).reason), /slot_occupied/);
    const winner = (ok[0] as PromiseFulfilledResult<{ id: string; userId: string }>).value;
    await cancelBooking(winner.id, winner.userId, true);
  });

  it("forMemberName alleo → family_member_forbidden", async () => {
    const free = await futureFreeSlots(1);
    assert.ok(free[0]);
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: "muni-exemplo",
          slotId: free[0]!.id,
          userId: "user-cidada",
          userDisplayName: "Ana",
          forMemberId: "fam-alleo",
          forMemberName: "Intruso",
        }),
      /family_member_forbidden/,
    );
  });

  it("anonimiza reservas pasadas", async () => {
    const oldDate = addDaysIso(todayIso(), -100);
    const slotId = `slot-anon-${randomUUID().slice(0, 8)}`;
    await insertSlot({
      id: slotId,
      unitId: "unit-padel-1",
      municipalityId: "muni-exemplo",
      date: oldDate,
      start: "10:00",
      end: "11:00",
    });
    const bid = randomUUID();
    await getDb().insert(t.bookings).values({
      id: bid,
      municipalityId: "muni-exemplo",
      unitId: "unit-padel-1",
      facilityId: "fac-exemplo-padel",
      userId: "user-old",
      userDisplayName: "Persoa Real",
      slotId,
      date: oldDate,
      start: "10:00",
      end: "11:00",
      status: "checked_in",
      shortCode: "PA-TEST",
      qrPayload: "x",
      forMemberId: null,
      forMemberName: null,
      bookedByStaff: false,
      createdAt: new Date(),
    });
    const n = await anonymizePastBookings();
    assert.ok(n >= 1);
    const found = await getDb()
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.id, bid))
      .limit(1);
    assert.equal(found[0]?.userDisplayName, "Anonimizado");
  });
});
