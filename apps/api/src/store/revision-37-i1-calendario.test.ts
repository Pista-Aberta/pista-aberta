/**
 * REVISION-37 I1 — «Engadir ao calendario»: URL do correo → 200 text/calendar;
 * token doutra reserva → 403; cancelada → METHOD:CANCEL.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r37-i1-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-37-i1-calendarioxx";
process.env.APP_BASE_URL = "https://demo.pistaaberta.com";
process.env.PA_DEMO = "1";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBooking, getBooking, getFacility } = await import("./db.js");
const { signBookingIcsToken } = await import("../lib/booking-ics-token.js");
const { bookingCalendarIcsUrl } = await import(
  "../notify/emails/booking-content.js"
);
const { municipalityMiddleware } = await import("../tenancy.js");
const t = await import("../db/schema.js");

const mid = "muni-exemplo";
const unitId = "unit-padel-1";

function nearDate(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(1, Math.min(6, offsetDays)));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function insertSlot(opts: {
  date: string;
  start: string;
  end: string;
}): Promise<string> {
  const id = `slot-i1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
  assert.ok(hit[0]);
  return hit[0]!.id;
}

function mountIcsApp(): Hono {
  const app = new Hono();
  app.get(
    "/api/c/:slug/reservas/:id/calendario.ics",
    municipalityMiddleware,
    async (c) => {
      const token = c.req.query("t") || c.req.query("token");
      if (!token) return c.text("token required", 400);
      const { verifyBookingIcsToken } = await import(
        "../lib/booking-ics-token.js"
      );
      const bookingId = verifyBookingIcsToken(token);
      if (!bookingId || bookingId !== c.req.param("id")) {
        return c.text("invalid token", 403);
      }
      const b = await getBooking(bookingId);
      if (!b || b.municipalityId !== c.get("municipalityId")) {
        return c.text("not found", 404);
      }
      const fac = await getFacility(b.facilityId);
      const { buildBookingIcs, buildBookingCancelIcs } = await import(
        "../lib/booking-ics.js"
      );
      const cancelled = b.status === "cancelled";
      const body = cancelled
        ? buildBookingCancelIcs({
            id: b.id,
            facilityName: fac?.name ?? "Reserva",
            date: b.date,
            start: b.start,
            end: b.end,
            sequence: (b.icsSequence ?? 0) + 1,
          })
        : buildBookingIcs({
            id: b.id,
            facilityName: fac?.name ?? "Reserva",
            date: b.date,
            start: b.start,
            end: b.end,
            shortCode: b.shortCode,
            sequence: b.icsSequence ?? 0,
          });
      return c.text(body, 200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="reserva-${b.id}.ics"`,
      });
    },
  );
  return app;
}

describe("REVISION-37 I1 calendario.ics", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });
  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("bookingCalendarIcsUrl usa /calendario.ics (non :id.ics)", () => {
    const url = bookingCalendarIcsUrl({ slug: "exemplo", bookingId: "bk-x" });
    assert.match(url, /\/api\/c\/exemplo\/reservas\/bk-x\/calendario\.ics\?t=/);
    assert.doesNotMatch(url, /reservas\/bk-x\.ics/);
  });

  it("URL do correo → 200 text/calendar co UID; token alleo → 403; cancelada → METHOD:CANCEL", async () => {
    await getDb()
      .update(t.bookings)
      .set({ status: "cancelled" })
      .where(eq(t.bookings.userId, "user-cidada"));

    const date = nearDate(2);
    const slotId = await insertSlot({ date, start: "04:00", end: "05:00" });
    const booking = await createBooking({
      municipalityId: mid,
      slotId,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
      userRole: "citizen",
    });

    const app = mountIcsApp();
    const url = bookingCalendarIcsUrl({
      slug: "exemplo",
      bookingId: booking.id,
    });
    const pathAndQuery = url.replace("https://demo.pistaaberta.com", "");

    const ok = await app.request(pathAndQuery);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type") ?? "", /text\/calendar/);
    const body = await ok.text();
    assert.match(body, new RegExp(`UID:booking-${booking.id}@pistaaberta\\.com`));
    assert.match(body, /METHOD:PUBLISH/);

    const otherTok = signBookingIcsToken("outra-reserva-id");
    const bad = await app.request(
      `/api/c/exemplo/reservas/${booking.id}/calendario.ics?t=${encodeURIComponent(otherTok)}`,
    );
    assert.equal(bad.status, 403);

    await getDb()
      .update(t.bookings)
      .set({ status: "cancelled" })
      .where(eq(t.bookings.id, booking.id));
    const cancelUrl = bookingCalendarIcsUrl({
      slug: "exemplo",
      bookingId: booking.id,
    });
    const cancelled = await app.request(
      cancelUrl.replace("https://demo.pistaaberta.com", ""),
    );
    assert.equal(cancelled.status, 200);
    assert.match(await cancelled.text(), /METHOD:CANCEL/);
  });
});
