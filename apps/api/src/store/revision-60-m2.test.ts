import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq, sql } from "drizzle-orm";
import { initDb, closeDb, getDb } from "../db/client.js";
import { migrateSchema } from "../db/migrate.js";
import { seedDb } from "../db/seed-db.js";
import * as t from "../db/schema.js";
import { createBooking, getBooking, listSlots } from "./db.js";
import { acceptWaitlistOffer, addWaitlist, listMyWaitlist } from "./extra.js";
import { markNoShow } from "./rev4-ops.js";
import { ensureSlotsAhead } from "./slots-ahead.js";
import { addDaysIso, DEFAULT_TIMEZONE, localDateIso } from "./business-rules.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev60-m2-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

describe("REVISION-60 M2 liberación real por non presentado", () => {
  const mid = "muni-exemplo";
  let day1 = "";
  let day2 = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 7 });
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    day1 = addDaysIso(today, 2);
    day2 = addDaysIso(today, 3);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("migración recrea bookings_slot_active_idx se viña do índice antigo (status <> 'cancelled')", async () => {
    const db = getDb();
    await db.execute(sql.raw(`DROP INDEX IF EXISTS bookings_slot_active_idx`));
    await db.execute(
      sql.raw(
        `CREATE UNIQUE INDEX bookings_slot_active_idx ON bookings(slot_id) WHERE status <> 'cancelled'`,
      ),
    );

    await migrateSchema();

    const res = await db.execute(
      sql.raw(`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'bookings_slot_active_idx'
      `),
    );
    const rows = Array.isArray(res)
      ? res
      : ((res as { rows?: Array<{ indexdef?: string }> }).rows ?? []);
    const indexdef = String((rows[0] as { indexdef?: string } | undefined)?.indexdef ?? "");
    assert.match(indexdef, /no_show/);
  });

  it("reserva -> markNoShow -> listSlots libre -> outra persoa reserva OK (mesmo en pistas incompatibles)", async () => {
    const slots = await listSlots({
      municipalityId: mid,
      unitId: "unit-pav-full",
      date: day1,
    });
    const free = slots.find((s) => !s.occupied && !s.closed);
    assert.ok(free, "debe haber franxa libre en unit-pav-full");

    const b1 = await createBooking({
      municipalityId: mid,
      slotId: free!.id,
      userId: "user-cidada",
      userDisplayName: "Ana",
    });

    const beforeNoShow = await listSlots({
      municipalityId: mid,
      facilityId: "fac-exemplo-pav",
      date: day1,
    });
    assert.equal(beforeNoShow.find((s) => s.id === free!.id)?.occupied, true);
    const halfAtSameHour = beforeNoShow.find(
      (s) => s.unitId === "unit-pav-a" && s.start === free!.start,
    );
    if (halfAtSameHour) {
      assert.equal(halfAtSameHour.occupied, true);
    }

    const marked = await markNoShow(mid, b1.id, "staff-test", { penalize: false });
    assert.equal(marked.status, "no_show");

    const afterNoShow = await listSlots({
      municipalityId: mid,
      facilityId: "fac-exemplo-pav",
      date: day1,
    });
    assert.equal(afterNoShow.find((s) => s.id === free!.id)?.occupied, false);
    if (halfAtSameHour) {
      assert.equal(
        afterNoShow.find((s) => s.id === halfAtSameHour.id)?.occupied,
        false,
      );
    }

    const b2 = await createBooking({
      municipalityId: mid,
      slotId: free!.id,
      userId: "user-brais",
      userDisplayName: "Luis",
    });
    assert.equal(b2.status, "confirmed");
    assert.equal((await getBooking(b1.id))?.status, "no_show");
  });

  it("reserva + lista de espera -> markNoShow -> oferta enviada e aceptable con acceptWaitlistOffer", async () => {
    const slots = await listSlots({
      municipalityId: mid,
      unitId: "unit-padel-1",
      date: day2,
    });
    const free = slots.find((s) => !s.occupied && !s.closed);
    assert.ok(free, "debe haber franxa libre en unit-padel-1");

    const b1 = await createBooking({
      municipalityId: mid,
      slotId: free!.id,
      userId: "user-cidada",
      userDisplayName: "Ana",
    });

    await getDb()
      .delete(t.waitlistEntries)
      .where(
        and(
          eq(t.waitlistEntries.municipalityId, mid),
          eq(t.waitlistEntries.userId, "user-diego"),
        ),
      );

    await addWaitlist({
      municipalityId: mid,
      slotId: free!.id,
      userId: "user-diego",
      userDisplayName: "Miguel",
    });

    await markNoShow(mid, b1.id, "staff-test", { penalize: false });

    const myWaitlist = await listMyWaitlist(mid, "user-diego");
    const offer = myWaitlist.find((w) => w.slotId === free!.id);
    assert.ok(offer, "a entrada da lista de espera debe recibir oferta");
    assert.equal(offer!.status, "offered");

    const accepted = await acceptWaitlistOffer(
      mid,
      "user-diego",
      "Miguel",
      new Date(),
      free!.id,
    );
    assert.equal(accepted.slotId, free!.id);
    const created = await getBooking(accepted.bookingId);
    assert.equal(created?.status, "confirmed");
    assert.equal(created?.userId, "user-diego");
  });
});
