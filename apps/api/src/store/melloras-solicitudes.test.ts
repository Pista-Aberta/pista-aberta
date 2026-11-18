/**
 * Solicitudes de tempada/partido: facility obrigatorio, choque, mover, avisos.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-solic-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const {
  createClubRequest,
  approveClubRequest,
  moveClubRequest,
  listClubRequests,
} = await import("./admin-ops.js");

describe("melloras solicitudes approve", () => {
  const mid = "muni-exemplo";
  const clubId = "club-volei";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("seed ten propostas pendentes de demo", async () => {
    const pending = await listClubRequests(mid, "pending");
    assert.ok(pending.some((r) => r.id === "req-demo-season-pending"));
    assert.ok(pending.some((r) => r.id === "req-demo-match-pending"));
  });

  it("createClubRequest sen facilityId → facility_required", async () => {
    await assert.rejects(
      () =>
        createClubRequest({
          municipalityId: mid,
          clubId,
          type: "season",
          payload: {
            unitId: "unit-pav-a",
            weekday: 1,
            start: "09:00",
            end: "10:00",
          },
          userId: "user-club-volei",
          userName: "Volei test",
        }),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message, "facility_required");
        return true;
      },
    );
  });

  it("aprobar franxa que solapa → conflict", async () => {
    // ss1 seed: club-basquet · unit-pav-full · weekday 2 · 18:00–19:30
    const req = await createClubRequest({
      municipalityId: mid,
      clubId,
      type: "season",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-full",
        weekday: 2,
        start: "18:30",
        end: "19:45",
      },
      userId: "user-club",
      userName: "Volei test",
    });
    await assert.rejects(
      () => approveClubRequest(mid, req.id, "test-admin"),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message, "conflict");
        return true;
      },
    );
  });

  it("aprobar franxa libre unha vez OK; repetir exacta → conflict/duplicate", async () => {
    /* L–V pavillón 16–22 (REVISION-47 W1). */
    const payload = {
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-a",
      weekday: 1,
      start: "17:00",
      end: "18:00",
    };
    const first = await createClubRequest({
      municipalityId: mid,
      clubId,
      type: "season",
      payload,
      userId: "user-club",
      userName: "Volei test",
    });
    const approved = await approveClubRequest(mid, first.id, "test-admin");
    assert.ok(approved);

    const second = await createClubRequest({
      municipalityId: mid,
      clubId,
      type: "season",
      payload,
      userId: "user-club",
      userName: "Volei test",
    });
    await assert.rejects(
      () => approveClubRequest(mid, second.id, "test-admin"),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.ok(e.message === "conflict" || e.message === "duplicate");
        return true;
      },
    );
  });

  it("mover proposta → counter_proposed + aviso humano ao club (J4/J6)", async () => {
    const req = await createClubRequest({
      municipalityId: mid,
      clubId: "club-basquet",
      type: "season",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-b",
        weekday: 0,
        start: "09:00",
        end: "10:00",
      },
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });
    const moved = await moveClubRequest(mid, req.id, "test-admin", {
      weekday: 0,
      start: "11:00",
      end: "12:00",
      unitId: "unit-pav-a",
      facilityId: "fac-exemplo-pav",
    });
    assert.equal(moved.status, "counter_proposed");
    assert.equal(moved.payload.start, "11:00");
    assert.equal(moved.payload.unitId, "unit-pav-a");

    const notices = await getDb()
      .select()
      .from(t.notices)
      .where(
        and(
          eq(t.notices.municipalityId, mid),
          eq(t.notices.userId, "user-club"),
        ),
      );
    /* REVISION-39 L1: corpo «Pediu: … · Propuxemos: …» (sen ids de unidade). */
    assert.ok(
      notices.some(
        (n) =>
          /propón/i.test(n.title) &&
          /Pediu:.*Propuxemos:/i.test(n.body) &&
          !n.body.includes("unit-pav"),
      ),
    );
  });

  it("createClubRequest avisa aos admins (userId do admin)", async () => {
    const before = await getDb()
      .select()
      .from(t.notices)
      .where(eq(t.notices.userId, "user-admin"));
    const nBefore = before.length;

    await createClubRequest({
      municipalityId: mid,
      clubId: "club-basquet",
      type: "match",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-a",
        date: "2099-01-10",
        start: "08:00",
        end: "09:00",
        homeTeam: "Local",
        awayTeam: "Visitante",
      },
      note: "Aviso admin test",
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });

    const after = await getDb()
      .select()
      .from(t.notices)
      .where(eq(t.notices.userId, "user-admin"));
    assert.ok(after.length > nBefore);
    assert.ok(after.some((n) => n.body.includes("Aviso admin test")));
  });
});
