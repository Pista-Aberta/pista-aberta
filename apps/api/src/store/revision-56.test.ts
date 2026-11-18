/**
 * REVISION-56 H1–H4: unidades, peches por horas, tempadas, rendimento.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev56-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-revision-56";
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");
const { adminMellorasRoutes } = await import("../routes/admin-melloras.js");
const { optionalAuth } = await import("../middleware/auth.js");
const {
  createClosureAdmin,
  previewClosureImpact,
  createClubRequest,
  approveClubRequest,
  clubRequestConflicts,
  checkInByShortCode,
} = await import("./admin-ops.js");
const {
  createBooking,
  listSlots,
  dashboardStats,
  exportOpenData,
} = await import("./db.js");
const { regenerateSlotsForUnitAhead, ensureSlotsAhead } = await import(
  "./slots-ahead.js"
);
const {
  addDaysIso,
  localDateIso,
  localWeekday,
  DEFAULT_TIMEZONE,
} = await import("./business-rules.js");
const { formatDayChip } = await import("@pista-aberta/shared");
const t = await import("../db/schema.js");

function buildApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    return c.json({ error: "internal" }, 500);
  });
  app.use("*", optionalAuth);
  app.route("/", adminMellorasRoutes);
  return app;
}

describe("REVISION-56 H1–H4", () => {
  const app = buildApp();
  const mid = "muni-exemplo";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 14 });
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("H1: POST unidade con slotMinutes 0 → 400", async () => {
    const admin = SAML_DEMO_USERS.admin!;
    const { key: _k, givenName: _g, familyName: _f, ...rest } = admin;
    const sid = await createSession(rest);
    const res = await app.request("/api/c/exemplo/admin/instalacions/fac-exemplo-padel/unidades", {
      method: "POST",
      headers: {
        Cookie: `pa_sesion=${sid}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Unidade perigosa",
        slotMinutes: 0,
        capacity: 4,
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "validation_error");
  });

  it("H1: xerador con slotMinutes 0 remata (fallback 60)", async () => {
    const touched = await regenerateSlotsForUnitAhead(mid, "unit-padel-1", {
      slotMinutes: 0,
      days: 1,
    });
    assert.ok(typeof touched === "number");
    assert.ok(Number.isFinite(touched));
  });

  it("H2: peche 18:00–19:00 só pecha esa franxa e non cancela a das 16:00", async () => {
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const day = addDaysIso(today, 3);
    const unitId = "unit-padel-2";
    const facilityId = "fac-exemplo-padel";

    await regenerateSlotsForUnitAhead(mid, unitId, { days: 5 });

    const slot16 = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, unitId),
            eq(t.timeSlots.date, day),
            eq(t.timeSlots.start, "16:00"),
          ),
        )
        .limit(1)
    )[0];
    const slot18 = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, unitId),
            eq(t.timeSlots.date, day),
            eq(t.timeSlots.start, "18:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(slot16, "franxa 16:00");
    assert.ok(slot18, "franxa 18:00");

    const booking = await createBooking({
      municipalityId: mid,
      slotId: slot16.id,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
    });

    const impact = await previewClosureImpact(mid, {
      facilityId,
      unitId,
      startsAt: `${day}T18:00`,
      endsAt: `${day}T19:00`,
    });
    assert.equal(impact.cancelledCount, 0);
    assert.ok(!impact.bookingIds.includes(booking.id));

    const r = await createClosureAdmin(mid, "test-admin", {
      facilityId,
      unitId,
      startsAt: `${day}T18:00`,
      endsAt: `${day}T19:00`,
      reason: "Mantemento rede",
      notifyCitizens: false,
      confirm: true,
    });
    assert.equal(r.needsConfirm, false);
    assert.equal(r.cancelledCount, 0);

    const after16 = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(eq(t.timeSlots.id, slot16.id))
        .limit(1)
    )[0]!;
    const after18 = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(eq(t.timeSlots.id, slot18.id))
        .limit(1)
    )[0]!;
    assert.equal(after16.closed, false, "16:00 segue aberta");
    assert.equal(after18.closed, true, "18:00 pechada");

    const b = (
      await getDb()
        .select()
        .from(t.bookings)
        .where(eq(t.bookings.id, booking.id))
        .limit(1)
    )[0]!;
    assert.notEqual(b.status, "cancelled");

    await regenerateSlotsForUnitAhead(mid, unitId, { days: 5 });
    const regen18 = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(eq(t.timeSlots.id, slot18.id))
        .limit(1)
    )[0]!;
    assert.equal(regen18.closed, true, "closedByClosure respecta a hora");
  });

  it("H3: tempada detecta reserva futura e ao aprobar pecha franxas", async () => {
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    let sat = today;
    /* Sábado estritamente futuro: se hoxe é sábado, 16:00 pode xa estar no pasado. */
    for (let i = 0; i <= 21; i++) {
      const d = addDaysIso(today, i);
      if (localWeekday(d, DEFAULT_TIMEZONE) === 6 && d > today) {
        sat = d;
        break;
      }
    }
    assert.equal(localWeekday(sat, DEFAULT_TIMEZONE), 6);
    assert.ok(sat > today);

    await regenerateSlotsForUnitAhead(mid, "unit-pav-a", { days: 21 });
    await regenerateSlotsForUnitAhead(mid, "unit-pav-full", { days: 21 });

    const slot = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-pav-a"),
            eq(t.timeSlots.date, sat),
            eq(t.timeSlots.start, "16:00"),
            eq(t.timeSlots.closed, false),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(slot, `franxa libre sab ${sat} 16:00 media A`);

    /* Outra persoa: evita solape persoal coa reserva H2 de Ana. */
    await createBooking({
      municipalityId: mid,
      slotId: slot.id,
      userId: "user-brais",
      userDisplayName: "Luis Demo",
    });

    const req = await createClubRequest({
      municipalityId: mid,
      clubId: "club-basquet",
      type: "season",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-full",
        weekday: 6,
        start: "16:00",
        end: "17:00",
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });

    const conflicts = await clubRequestConflicts(mid, req.id);
    assert.ok(conflicts.some((c) => c.kind === "booking_overlap"));
    const detail = conflicts.find((c) => c.kind === "booking_overlap")!.detail;
    const chip = formatDayChip(sat, "gl");
    assert.match(detail, /Reserva de Luis D\./);
    assert.ok(detail.includes(chip));
    assert.ok(detail.includes("16:00-17:00"));
    assert.ok(detail.includes("Media pista A"));

    await assert.rejects(
      () => approveClubRequest(mid, req.id, "test-admin"),
      (e: unknown) => e instanceof Error && e.message === "conflict",
    );

    /* Aprobar nunha hora libre e comprobar rexeneración. */
    const freeReq = await createClubRequest({
      municipalityId: mid,
      clubId: "club-basquet",
      type: "season",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-full",
        weekday: 6,
        start: "19:00",
        end: "20:00",
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });
    await approveClubRequest(mid, freeReq.id, "test-admin");
    /* En test o xerador usa poucos días; forzar ventá coma en produción. */
    await regenerateSlotsForUnitAhead(mid, "unit-pav-full", { days: 21 });
    await regenerateSlotsForUnitAhead(mid, "unit-pav-a", { days: 21 });

    const closed = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.unitId, "unit-pav-full"),
            eq(t.timeSlots.date, sat),
            eq(t.timeSlots.start, "19:00"),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(closed);
    assert.equal(closed.closed, true);
    assert.equal(closed.closedReason, "tempada");
  });

  it("H4: listSlots con date filtra; checkIn por short_code; dashboard/openData acotados", async () => {
    const today = localDateIso(new Date(), DEFAULT_TIMEZONE);
    const daySlots = await listSlots({ municipalityId: mid, date: today });
    assert.ok(daySlots.every((s) => s.date === today));

    const facSlots = await listSlots({
      municipalityId: mid,
      facilityId: "fac-exemplo-padel",
      date: today,
    });
    assert.ok(facSlots.every((s) => s.date === today));

    const dash = await dashboardStats(mid);
    assert.ok(typeof dash.todayCount === "number");
    assert.ok(Array.isArray(dash.heat));

    const open = await exportOpenData(mid);
    assert.ok(Array.isArray(open.occupancy));
    for (const row of open.occupancy) {
      assert.ok(row.date >= addDaysIso(today, -30));
      assert.ok(row.date <= addDaysIso(today, 14));
    }

    const missing = await checkInByShortCode("PA-ZZZZ", mid);
    assert.equal(missing.valid, false);
  });
});
