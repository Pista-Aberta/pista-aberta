/**
 * Zona horaria Europe/Madrid con proceso en UTC (REVISION-2 §1).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-tz-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.TZ = "UTC";
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const {
  DEFAULT_TIMEZONE,
  localDateIso,
  slotInstant,
  QR_CHECKIN_MARGIN_MINUTES,
} = await import("./business-rules.js");
const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBooking, checkInByQr, cancelBooking } = await import("./db.js");
const t = await import("../db/schema.js");

describe("timezone Europe/Madrid (proceso TZ=UTC)", () => {
  it("localDateIso: 00:30 Madrid do día 23 → hoxe = 23", () => {
    // 2026-10-23 00:30 Europe/Madrid = 2026-10-22 22:30 UTC (CEST, UTC+2)
    const now = new Date("2026-10-22T22:30:00.000Z");
    assert.equal(localDateIso(now, DEFAULT_TIMEZONE), "2026-10-23");
    assert.equal(now.toISOString().slice(0, 10), "2026-10-22"); // UTC diría 22
  });

  it("slotInstant: 18:00 Madrid ≠ 18:00 UTC", () => {
    const instant = slotInstant("2026-10-22", "18:00", DEFAULT_TIMEZONE);
    // CEST (outubro): 18:00 Madrid = 16:00 UTC
    assert.equal(instant.toISOString(), "2026-10-22T16:00:00.000Z");
  });

  it("check-in 17:45 Madrid nunha franxa 18:00 → válido; 19:31 → fóra", async () => {
    await initDb();
    await migrateSchema();
    await seedDb();

    // Data fóra do seed (hoxe+0..2) pero dentro da antelación de 7 días
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const { addDaysIso } = await import("./business-rules.js");
    const date = addDaysIso(today, 3);
    // Hora fóra do seed (mañá/tarde) para non chocar co unique unit+date+start
    const start = "18:00";
    const end = "19:00";
    const slotId = `slot-tz-${randomUUID().slice(0, 8)}`;
    // Usar unit-pav-a (pavillón) que o seed non enche con franxas horarias
    await getDb().insert(t.timeSlots).values({
      id: slotId,
      unitId: "unit-pav-a",
      municipalityId: "muni-exemplo",
      date,
      start,
      end,
      closed: false,
      closedReason: null,
    });

    // Antes do comezo (17:00 Madrid) para poder reservar
    const bookAt = slotInstant(date, "17:00", DEFAULT_TIMEZONE);
    const b = await createBooking({
      municipalityId: "muni-exemplo",
      slotId,
      userId: "user-tz-checkin",
      userDisplayName: "TZ",
      now: bookAt,
      bookedByStaff: true,
    });

    const { eq } = await import("drizzle-orm");
    const resetConfirmed = async () => {
      await getDb()
        .update(t.bookings)
        .set({ status: "confirmed" })
        .where(eq(t.bookings.id, b.id));
    };

    const at1745 = slotInstant(date, "17:45", DEFAULT_TIMEZONE);
    const ok = await checkInByQr(b.qrPayload, "muni-exemplo", at1745);
    assert.equal(ok.valid, true, "17:45 Madrid debe estar dentro da ventá ±30");

    await resetConfirmed();

    // 19:31 Madrid = fin 19:00 + 31 min > margem 30 → fóra
    const at1931 = slotInstant(date, "19:31", DEFAULT_TIMEZONE);
    const late = await checkInByQr(b.qrPayload, "muni-exemplo", at1931);
    assert.equal(late.valid, false);
    assert.equal(late.reason, "fora_de_ventan");

    // Confirmación da margem: 19:30 exacto aínda vale
    await resetConfirmed();
    const at1930 = new Date(
      slotInstant(date, end, DEFAULT_TIMEZONE).getTime() +
        QR_CHECKIN_MARGIN_MINUTES * 60_000,
    );
    const edge = await checkInByQr(b.qrPayload, "muni-exemplo", at1930);
    assert.equal(edge.valid, true);

    await cancelBooking(b.id, "user-tz-checkin", true);
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
