/**
 * REVISION-39 — L1–L4, L8, L9 (contraproposta, Ana, payload público).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r39-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { ensureAnaWaitlistOffer } = await import("./demo-bookings.js");
const { ensureRollingDemoSlots } = await import("./demo-slots.js");
const { ensureEveningSlotsExtended } = await import("./demo-bookings.js");
const {
  createClubRequest,
  moveClubRequest,
  acceptClubCounter,
  rejectClubCounter,
  publicClubPayload,
} = await import("./admin-ops.js");

describe("REVISION-39 L1–L4 L8 L9", () => {
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

  it("L1: rexeitar restaura payload.original do club", async () => {
    const req = await createClubRequest({
      municipalityId: "muni-exemplo",
      clubId: "club-basquet",
      type: "match",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-a",
        date: "2099-07-01",
        start: "20:00",
        end: "21:30",
        homeTeam: "Local",
        awayTeam: "Visitante",
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });

    /* Sábado 2099-07-04 · 12:30–14:00 (S–D 09–14; fóra da tempada 10–12). */
    const moved = await moveClubRequest("muni-exemplo", req.id, "admin-test", {
      date: "2099-07-04",
      start: "12:30",
      end: "14:00",
      unitId: "unit-pav-a",
      facilityId: "fac-exemplo-pav",
    });
    assert.equal(moved.status, "counter_proposed");
    assert.ok(moved.payload.original);
    const orig = moved.payload.original as Record<string, unknown>;
    assert.equal(orig.start, "20:00");
    assert.equal(moved.payload.start, "12:30");
    assert.equal(typeof moved.payload.counterVersion, "number");
    assert.equal(moved.payload._statusBeforeCounter, undefined);

    const rejected = await rejectClubCounter(
      "muni-exemplo",
      req.id,
      "user-club",
      { counterVersion: Number(moved.payload.counterVersion) },
    );
    assert.equal(rejected.status, "pending");
    assert.equal(rejected.payload?.start, "20:00");
    assert.equal(rejected.payload?.date, "2099-07-01");
    assert.equal(rejected.payload?.original, undefined);
  });

  it("L2: dúas contrapropostas → aceptar coa primeira versión → 409", async () => {
    const req = await createClubRequest({
      municipalityId: "muni-exemplo",
      clubId: "club-basquet",
      type: "match",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-a",
        date: "2099-08-03",
        start: "17:00",
        end: "18:30",
        homeTeam: "A",
        awayTeam: "B",
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });

    const first = await moveClubRequest("muni-exemplo", req.id, "admin-test", {
      date: "2099-08-08",
      start: "12:30",
      end: "14:00",
      unitId: "unit-pav-a",
      facilityId: "fac-exemplo-pav",
    });
    const v1 = Number(first.payload.counterVersion);

    const second = await moveClubRequest("muni-exemplo", req.id, "admin-test", {
      date: "2099-08-09",
      start: "12:30",
      end: "14:00",
      unitId: "unit-pav-a",
      facilityId: "fac-exemplo-pav",
    });
    const v2 = Number(second.payload.counterVersion);
    assert.ok(v2 > v1);

    await assert.rejects(
      () =>
        acceptClubCounter("muni-exemplo", req.id, "user-club", {
          counterVersion: v1,
        }),
      /stale_counter/,
    );

    const ok = await acceptClubCounter("muni-exemplo", req.id, "user-club", {
      counterVersion: v2,
    });
    assert.equal(ok.status, "approved");
  });

  it("L3: outra xestora do mesmo club pode aceptar", async () => {
    const req = await createClubRequest({
      municipalityId: "muni-exemplo",
      clubId: "club-basquet",
      type: "match",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-b",
        date: "2099-09-01",
        start: "16:00",
        end: "17:30",
        homeTeam: "C",
        awayTeam: "D",
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });
    /* Sábado 2099-09-05 · 12:30–14:00 (fóra tempada 10–12 na completa). */
    const moved = await moveClubRequest("muni-exemplo", req.id, "admin-test", {
      date: "2099-09-05",
      start: "12:30",
      end: "14:00",
      unitId: "unit-pav-b",
      facilityId: "fac-exemplo-pav",
    });
    const accepted = await acceptClubCounter(
      "muni-exemplo",
      req.id,
      "user-club-2",
      { counterVersion: Number(moved.payload.counterVersion) },
    );
    assert.equal(accepted.status, "approved");
  });

  it("L4: a calquera minuto Ana ten oferta viva (2h + renovar caducada)", async () => {
    const now = new Date();
    assert.equal(await ensureAnaWaitlistOffer(now), true);
    const again = await ensureAnaWaitlistOffer(
      new Date(now.getTime() + 10 * 60_000),
    );
    assert.equal(again, true);

    const entry = (
      await getDb()
        .select()
        .from(t.waitlistEntries)
        .where(eq(t.waitlistEntries.id, "wl-demo-ana-offer"))
        .limit(1)
    )[0];
    assert.ok(entry?.offeredUntil);
    assert.ok(entry!.offeredUntil!.getTime() > now.getTime());

    await getDb()
      .update(t.waitlistEntries)
      .set({ offeredUntil: new Date(now.getTime() - 60_000) })
      .where(eq(t.waitlistEntries.id, "wl-demo-ana-offer"));
    assert.equal(await ensureAnaWaitlistOffer(now), true);
    const renewed = (
      await getDb()
        .select()
        .from(t.waitlistEntries)
        .where(eq(t.waitlistEntries.id, "wl-demo-ana-offer"))
        .limit(1)
    )[0];
    assert.ok(renewed?.offeredUntil);
    assert.ok(renewed!.offeredUntil!.getTime() > now.getTime());
  });

  it("L9: publicClubPayload quita _statusBeforeCounter", () => {
    const pub = publicClubPayload({
      start: "10:00",
      _statusBeforeCounter: "pending",
      original: { start: "20:00" },
    });
    assert.equal(pub._statusBeforeCounter, undefined);
    assert.equal(pub.start, "10:00");
    assert.deepEqual(pub.original, { start: "20:00" });
  });
});
