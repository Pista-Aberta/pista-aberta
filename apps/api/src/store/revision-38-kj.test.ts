/**
 * REVISION-38 — K1–K3, J1–J6 (núcleo API).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r38-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createMunicipalityFromWizard } = await import("./municipality-launch.js");
const { createInvitation, acceptInvitation } = await import("./invitations.js");
const { ensureAnaWaitlistOffer } = await import("./demo-bookings.js");
const { ensureRollingDemoSlots } = await import("./demo-slots.js");
const { ensureEveningSlotsExtended } = await import("./demo-bookings.js");
const { acceptWaitlistOffer } = await import("./extra.js");
const {
  createClubRequest,
  moveClubRequest,
  acceptClubCounter,
  rejectClubCounter,
} = await import("./admin-ops.js");
const { cancelBooking, getBooking } = await import("./db.js");
const { renderBookingChanged } = await import("../notify/emails/booking-changed.js");

describe("revision-38 K/J", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    const now = new Date();
    await ensureRollingDemoSlots(now);
    await ensureEveningSlotsExtended(now);
    await ensureAnaWaitlistOffer(now);
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("K2: cancelBooking garda cancelReason", async () => {
    const slot = (
      await getDb()
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.municipalityId, "muni-exemplo"),
            eq(t.timeSlots.closed, false),
          ),
        )
        .limit(1)
    )[0];
    assert.ok(slot, "precisa franxa seed");
    const id = `bk-k2-cancel-reason-${Date.now()}`;
    /* Data futura para non disparar cancel_too_late (cancelMinHours). */
    await getDb().insert(t.bookings).values({
      id,
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      facilityId: "fac-exemplo-padel",
      unitId: slot.unitId,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
      date: "2099-06-15",
      start: "18:00",
      end: "19:00",
      status: "confirmed",
      shortCode: "K2TST",
      qrPayload: `pa:k2:${id}`,
    });
    await cancelBooking(id, "user-cidada", false, "Motivo cidadá");
    const again = await getBooking(id);
    assert.equal(again?.status, "cancelled");
    assert.equal(again?.cancelReason, "Motivo cidadá");
  });

  it("K3: alta sen adminNif → nif_required", async () => {
    await assert.rejects(
      () =>
        createMunicipalityFromWizard({
          name: "Concello de TestNif",
          slug: `testnif-${Date.now().toString(36)}`,
          ine: "15999",
          accentColor: "#002B4A",
          markedFacilities: ["Pista municipal"],
          schedule: { pista: { open: "09:00", close: "22:00" } },
          norms: { rule1: true },
          adminEmail: "admin@testnif.gal",
          adminDisplayName: "Admin Test",
          sandbox: true,
          createdBy: "test",
        }),
      /nif_required/,
    );
  });

  it("K3: convite admin sen NIF → nif_required; outro NIF non acepta", async () => {
    await assert.rejects(
      () =>
        createInvitation({
          municipalityId: "muni-exemplo",
          role: "admin",
          email: "alguen@proba.gal",
          createdBy: "test",
        }),
      /nif_required/,
    );

    const inv = await createInvitation({
      municipalityId: "muni-exemplo",
      role: "admin",
      email: "admin2@proba.gal",
      nif: "12345678Z",
      displayName: "Admin Dous",
      createdBy: "test",
    });
    const otherUser = {
      id: "user-other-nif",
      municipalityId: "muni-exemplo",
      role: "citizen" as const,
      displayName: "Outra Persoa",
      personIdentifier: "ES/ES/87654321X",
      email: "outra@proba.gal",
      locale: "gl" as const,
      active: true,
    };
    await assert.rejects(
      () => acceptInvitation({ token: inv.token, user: otherUser }),
      /invite_wrong_person/,
    );
  });

  it("J1: demo fresca → Ana ten oferta waitlist e aceptar-praza funciona", async () => {
    const entries = await getDb()
      .select()
      .from(t.waitlistEntries)
      .where(
        and(
          eq(t.waitlistEntries.userId, "user-cidada"),
          eq(t.waitlistEntries.status, "offered"),
        ),
      );
    assert.ok(entries.length >= 1, "oferta waitlist para Ana");
    const entry = entries[0]!;
    assert.ok(entry.offeredUntil);

    const notices = await getDb()
      .select()
      .from(t.notices)
      .where(eq(t.notices.id, "n3"));
    const n3 = notices[0];
    assert.ok(n3);
    const payload = n3.payload as Record<string, unknown> | null;
    assert.equal(payload?.slotId, entry.slotId);
    assert.ok(typeof payload?.holdUntil === "string");

    const result = await acceptWaitlistOffer(
      "muni-exemplo",
      "user-cidada",
      "Ana Demo",
      new Date(),
      entry.slotId,
    );
    assert.ok(result.bookingId);
    assert.equal(result.slotId, entry.slotId);
    const booking = await getBooking(result.bookingId);
    assert.ok(booking);
    assert.notEqual(booking.status, "cancelled");
  });

  it("J2: slotId alleo → no_offer", async () => {
    await ensureAnaWaitlistOffer(new Date());
    await assert.rejects(
      () =>
        acceptWaitlistOffer(
          "muni-exemplo",
          "user-cidada",
          "Ana Demo",
          new Date(),
          "slot-inexistente-xyz",
        ),
      /no_offer/,
    );
  });

  it("J4–J5: tres camiños counter_proposed (aceptar / rexeitar / sen tocar matches)", async () => {
    const matchRows = await getDb()
      .select()
      .from(t.matches)
      .where(eq(t.matches.municipalityId, "muni-exemplo"))
      .limit(1);
    const match = matchRows[0];
    assert.ok(match, "precisa partido seed");

    const beforeDate = match.date;
    const beforeStart = match.start;

    const req = await createClubRequest({
      municipalityId: "muni-exemplo",
      clubId: match.clubId ?? "club-basquet",
      type: "match_change",
      payload: {
        matchId: match.id,
        facilityId: match.facilityId,
        unitId: match.unitId,
        date: match.date,
        start: match.start,
        end: match.end,
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });

    /* S–D 09–14 / L–V 16–22 (REVISION-47 W1).
     * REVISION-50 A2: evitar 10:00–12:00 (tempada club-patin na completa). */
    const moved = await moveClubRequest("muni-exemplo", req.id, "admin-test", {
      date: "2099-06-20",
      start: "12:30",
      end: "14:00",
      unitId: match.unitId,
      facilityId: match.facilityId,
    });
    assert.equal(moved.status, "counter_proposed");

    const midMatch = (
      await getDb().select().from(t.matches).where(eq(t.matches.id, match.id)).limit(1)
    )[0]!;
    assert.equal(midMatch.date, beforeDate, "J5: non move o partido ata aceptar");
    assert.equal(midMatch.start, beforeStart);

    /* camiño rexeitar */
    const rejected = await rejectClubCounter(
      "muni-exemplo",
      req.id,
      "user-club",
    );
    assert.equal(rejected.status, "pending");

    const moved2 = await moveClubRequest("muni-exemplo", req.id, "admin-test", {
      date: "2099-06-21",
      start: "10:00",
      end: "11:30",
      unitId: match.unitId,
      facilityId: match.facilityId,
    });
    assert.equal(moved2.status, "counter_proposed");

    const accepted = await acceptClubCounter(
      "muni-exemplo",
      req.id,
      "user-club",
    );
    assert.equal(accepted.status, "approved");

    const afterMatch = (
      await getDb().select().from(t.matches).where(eq(t.matches.id, match.id)).limit(1)
    )[0]!;
    assert.equal(afterMatch.date, "2099-06-21");
    assert.equal(afterMatch.start, "10:00");
  });

  it("K6: correo Reserva cambiada ten Engadir ao calendario", async () => {
    const muni = (
      await getDb()
        .select()
        .from(t.municipalities)
        .where(eq(t.municipalities.id, "muni-exemplo"))
        .limit(1)
    )[0]!;
    const { mapMunicipality } = await import("../db/mappers.js");
    const rendered = renderBookingChanged(mapMunicipality(muni), "gl", {
      userName: "Ana",
      facilityName: "Pistas",
      beforeLabel: "mér 10:00",
      afterDayLabel: "xov 11",
      afterTimeLabel: "11:00",
      date: "2026-11-12",
      start: "11:00",
      end: "12:00",
      shortCode: "ABCD",
      bookingId: "bk-test",
      icsSequence: 1,
    });
    assert.match(rendered.html, /calendario\.ics|Engadir ao calendario|cta\.addToCalendar|addToCalendar/i);
    assert.match(rendered.html, /calendario\.ics/);
  });
});
