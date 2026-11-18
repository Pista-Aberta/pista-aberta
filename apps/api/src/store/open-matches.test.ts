/**
 * REVISION-40 — partidos abertos P2/M: reserva obrigatoria, privacidade, límites.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-om-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-open-matches";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  createOpenMatch,
  createBookingWithOpenMatch,
  joinOpenMatch,
  leaveOpenMatch,
  inviteToOpenMatch,
  cancelOpenMatch,
  listOpenMatches,
  openMatchQrPayload,
  seedDemoOpenMatches,
} = await import("./open-matches.js");
const { createBooking, cancelBooking, modifyBooking, listSlots } = await import(
  "./db.js"
);
const { todayIso, slotDateTime } = await import("./business-rules.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

async function freeSlotFar() {
  const slots = await listSlots({
    municipalityId: "muni-exemplo",
    facilityId: "fac-exemplo-padel",
  });
  const min = Date.now() + 3 * 3_600_000;
  const free = slots.find(
    (s) =>
      !s.occupied &&
      !s.closed &&
      slotDateTime(s.date, s.start).getTime() > min,
  );
  assert.ok(free, "franxa libre a >3 h");
  return free;
}

describe("partidos abertos REVISION-40", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("sen bookingId → booking_required; reserva allea → forbidden", async () => {
    await assert.rejects(
      () =>
        createOpenMatch({
          municipalityId: "muni-exemplo",
          userId: "user-cidada",
          displayName: "Ana",
          nameDisplayConsent: true,
          bookingId: "",
          title: "Sen reserva",
        }),
      /booking_required/,
    );

    const slot = await freeSlotFar();
    const b = await createBooking({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-brais",
      userDisplayName: "Luis",
    });
    await assert.rejects(
      () =>
        createOpenMatch({
          municipalityId: "muni-exemplo",
          userId: "user-cidada",
          displayName: "Ana",
          nameDisplayConsent: true,
          bookingId: b.id,
          title: "Alleo",
        }),
      /forbidden/,
    );
    await cancelBooking(b.id, "user-brais", true);
  });

  it("P2: crear desde slot → reserva + partido; ocupada → 409", async () => {
    const slot = await freeSlotFar();
    const { booking, match } = await createBookingWithOpenMatch({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-cidada",
      displayName: "Ana Demo",
      nameDisplayConsent: true,
      title: "Partido P2",
      spotsTotal: 4,
    });
    assert.ok(booking.id);
    assert.equal(match.bookingId, booking.id);
    assert.equal(match.spotsTaken, 1);
    assert.ok(!("organizerUserId" in match));
    assert.ok(!match.players.some((p) => "userId" in p));

    await assert.rejects(
      () =>
        createBookingWithOpenMatch({
          municipalityId: "muni-exemplo",
          slotId: slot.id,
          userId: "user-brais",
          displayName: "Luis",
          nameDisplayConsent: true,
          title: "Choque",
        }),
      /slot_occupied/,
    );
    await cancelBooking(booking.id, "user-cidada", true);
  });

  it("completo desaparece da lista pública; ao saír volve", async () => {
    const slot = await freeSlotFar();
    const { booking, match } = await createBookingWithOpenMatch({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-cidada",
      displayName: "Ana Demo",
      nameDisplayConsent: true,
      title: "Case cheo",
      spotsTotal: 2,
    });
    await joinOpenMatch({
      municipalityId: "muni-exemplo",
      openMatchId: match.id,
      userId: "user-brais",
      displayName: "Luis Demo",
      nameDisplayConsent: true,
    });
    const pub = await listOpenMatches("muni-exemplo", {
      publicList: true,
      fromDate: todayIso(),
    });
    assert.ok(!pub.some((m) => m.id === match.id));

    const asLuis = await listOpenMatches("muni-exemplo", {
      publicList: true,
      userId: "user-brais",
      fromDate: todayIso(),
    });
    assert.ok(asLuis.some((m) => m.id === match.id));

    await leaveOpenMatch({
      municipalityId: "muni-exemplo",
      openMatchId: match.id,
      userId: "user-brais",
    });
    const again = await listOpenMatches("muni-exemplo", {
      publicList: true,
      fromDate: todayIso(),
    });
    assert.ok(again.some((m) => m.id === match.id && m.status === "open"));
    await cancelBooking(booking.id, "user-cidada", true);
  });

  it("lista sen sesión sen nomes; con sesión pila+inicial", async () => {
    await seedDemoOpenMatches(new Date());
    const anon = await listOpenMatches("muni-exemplo", {
      publicList: true,
      fromDate: todayIso(),
    });
    for (const m of anon) {
      assert.equal(m.organizerName, undefined);
      assert.equal(m.players.length, 0);
      assert.ok(!("organizerUserId" in m));
    }
    const authed = await listOpenMatches("muni-exemplo", {
      publicList: true,
      userId: "user-brais",
      fromDate: todayIso(),
    });
    const withName = authed.find((m) => m.organizerName);
    if (withName?.organizerName) {
      assert.match(withName.organizerName, /\w+\s+\w\./);
    }
  });

  it("cancelar reserva → partido cancelado", async () => {
    const slot = await freeSlotFar();
    const { booking, match } = await createBookingWithOpenMatch({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-cidada",
      displayName: "Ana Demo",
      nameDisplayConsent: true,
      title: "Cancel cascade",
    });
    await joinOpenMatch({
      municipalityId: "muni-exemplo",
      openMatchId: match.id,
      userId: "user-brais",
      displayName: "Luis",
      nameDisplayConsent: true,
    });
    await cancelBooking(booking.id, "user-cidada");
    const [row] = await getDb()
      .select()
      .from(t.openMatches)
      .where(eq(t.openMatches.id, match.id))
      .limit(1);
    assert.equal(row?.status, "cancelled");
  });

  it("cambiar reserva → move o partido", async () => {
    const slots = await listSlots({
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-padel",
    });
    const min = Date.now() + 3 * 3_600_000;
    const free = slots.filter(
      (s) =>
        !s.occupied &&
        !s.closed &&
        slotDateTime(s.date, s.start).getTime() > min,
    );
    assert.ok(free.length >= 2);
    const { booking, match } = await createBookingWithOpenMatch({
      municipalityId: "muni-exemplo",
      slotId: free[0]!.id,
      userId: "user-cidada",
      displayName: "Ana Demo",
      nameDisplayConsent: true,
      title: "Mover hora",
    });
    const { booking: moved } = await modifyBooking({
      bookingId: booking.id,
      newSlotId: free[1]!.id,
      userId: "user-cidada",
    });
    const [row] = await getDb()
      .select()
      .from(t.openMatches)
      .where(eq(t.openMatches.id, match.id))
      .limit(1);
    assert.equal(row?.date, moved.date);
    assert.equal(row?.start, moved.start);
    await cancelBooking(moved.id, "user-cidada", true);
  });

  it("choque de horario ao apuntarse → schedule_conflict", async () => {
    const slots = await listSlots({
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-padel",
    });
    const min = Date.now() + 3 * 3_600_000;
    const free = slots.filter(
      (s) =>
        !s.occupied &&
        !s.closed &&
        slotDateTime(s.date, s.start).getTime() > min,
    );
    assert.ok(free.length >= 2);
    const sameStart = free.filter((s) => s.date === free[0]!.date && s.start === free[0]!.start);
    const a = free[0]!;
    const b =
      sameStart.find((s) => s.id !== a.id) ??
      free.find((s) => s.date === a.date && s.start === a.start && s.id !== a.id);
    /* Se non hai dous slots á mesma hora, crear conflicto coa propia reserva na mesma franxa vía booking. */
    const { booking, match } = await createBookingWithOpenMatch({
      municipalityId: "muni-exemplo",
      slotId: a.id,
      userId: "user-cidada",
      displayName: "Ana Demo",
      nameDisplayConsent: true,
      title: "Choque join",
      spotsTotal: 4,
    });
    /* Luis reserva a mesma hora noutra pista se existe */
    if (b) {
      const bBook = await createBooking({
        municipalityId: "muni-exemplo",
        slotId: b.id,
        userId: "user-brais",
        userDisplayName: "Luis",
      });
      await assert.rejects(
        () =>
          joinOpenMatch({
            municipalityId: "muni-exemplo",
            openMatchId: match.id,
            userId: "user-brais",
            displayName: "Luis",
            nameDisplayConsent: true,
          }),
        /schedule_conflict/,
      );
      await cancelBooking(bBook.id, "user-brais", true);
    }
    await cancelBooking(booking.id, "user-cidada", true);
  });

  it("título con HTML → title_invalid; convite 11 → invite_limit_match", async () => {
    const slotBad = await freeSlotFar();
    await assert.rejects(
      () =>
        createBookingWithOpenMatch({
          municipalityId: "muni-exemplo",
          slotId: slotBad.id,
          userId: "user-cidada",
          displayName: "Ana",
          nameDisplayConsent: true,
          title: "<b>Gaña</b> https://phish.example",
        }),
      /title_invalid/,
    );
    const slot = await freeSlotFar();
    const { booking, match } = await createBookingWithOpenMatch({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-cidada",
      displayName: "Ana Demo",
      nameDisplayConsent: true,
      title: "Convites limite",
    });

    for (let i = 0; i < 10; i++) {
      await inviteToOpenMatch({
        municipalityId: "muni-exemplo",
        openMatchId: match.id,
        fromUserId: "user-cidada",
        toEmail: `amiga${i}@demo.pistaaberta.com`,
      });
    }
    await assert.rejects(
      () =>
        inviteToOpenMatch({
          municipalityId: "muni-exemplo",
          openMatchId: match.id,
          fromUserId: "user-cidada",
          toEmail: "amiga11@demo.pistaaberta.com",
        }),
      /invite_limit_match/,
    );
    /* Luis non pode convidar */
    await joinOpenMatch({
      municipalityId: "muni-exemplo",
      openMatchId: match.id,
      userId: "user-brais",
      displayName: "Luis",
      nameDisplayConsent: true,
    });
    await assert.rejects(
      () =>
        inviteToOpenMatch({
          municipalityId: "muni-exemplo",
          openMatchId: match.id,
          fromUserId: "user-brais",
          toEmail: "outra@demo.pistaaberta.com",
        }),
      /forbidden/,
    );
    await cancelBooking(booking.id, "user-cidada", true);
  });

  it("seed demo ten ≥3 partidos con bookingId e QR aleatorio", async () => {
    const n = await seedDemoOpenMatches(new Date());
    assert.ok(n >= 3);
    const list = await listOpenMatches("muni-exemplo", { includeClosed: true });
    const demos = list.filter((m) => m.id.startsWith("om-demo-"));
    assert.ok(demos.length >= 3);
    for (const d of demos) {
      const [row] = await getDb()
        .select()
        .from(t.openMatches)
        .where(eq(t.openMatches.id, d.id))
        .limit(1);
      assert.ok(row?.bookingId);
      assert.ok(row?.qrToken && row.qrToken.length >= 24);
      assert.notEqual(row.notes, "Demo TANDA-2");
      const qr = await openMatchQrPayload("muni-exemplo", d.id);
      assert.ok(qr?.token);
    }
  });

  it("cancelOpenMatch admin esixe motivo vía API contract (store acepta)", async () => {
    const slot = await freeSlotFar();
    const { booking, match } = await createBookingWithOpenMatch({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-cidada",
      displayName: "Ana Demo",
      nameDisplayConsent: true,
      title: "Admin cancel",
    });
    await cancelOpenMatch({
      municipalityId: "muni-exemplo",
      openMatchId: match.id,
      userId: "user-admin",
      asAdmin: true,
      reason: "Peche do pavillón",
    });
    const [row] = await getDb()
      .select()
      .from(t.openMatches)
      .where(eq(t.openMatches.id, match.id))
      .limit(1);
    assert.equal(row?.status, "cancelled");
    await cancelBooking(booking.id, "user-cidada", true);
  });

  it("crear/apuntarse sen consentimento → consent_required", async () => {
    const slot = await freeSlotFar();
    await assert.rejects(
      () =>
        createBookingWithOpenMatch({
          municipalityId: "muni-exemplo",
          slotId: slot.id,
          userId: "user-cidada",
          displayName: "Ana Demo",
          title: "Sen consent",
        }),
      /consent_required/,
    );
    await assert.rejects(
      () =>
        createBookingWithOpenMatch({
          municipalityId: "muni-exemplo",
          slotId: slot.id,
          userId: "user-cidada",
          displayName: "Ana Demo",
          title: "Sen consent false",
          nameDisplayConsent: false,
        }),
      /consent_required/,
    );

    const { booking, match } = await createBookingWithOpenMatch({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-cidada",
      displayName: "Ana Demo",
      nameDisplayConsent: true,
      title: "Con consent",
      spotsTotal: 4,
    });
    const [player] = await getDb()
      .select()
      .from(t.openMatchPlayers)
      .where(eq(t.openMatchPlayers.openMatchId, match.id))
      .limit(1);
    assert.ok(player?.nameConsentAt);

    await assert.rejects(
      () =>
        joinOpenMatch({
          municipalityId: "muni-exemplo",
          openMatchId: match.id,
          userId: "user-brais",
          displayName: "Luis Demo",
        }),
      /consent_required/,
    );
    await joinOpenMatch({
      municipalityId: "muni-exemplo",
      openMatchId: match.id,
      userId: "user-brais",
      displayName: "Luis Demo",
      nameDisplayConsent: true,
    });
    await cancelBooking(booking.id, "user-cidada", true);
  });
});
