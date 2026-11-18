/**
 * Tests mínimos API críticos: reserva, conflito de franxa, sorteo.
 * Usa PGlite efímero (sen Docker).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-test-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;

const { eq } = await import("drizzle-orm");
const { initDb, closeDb, getDbMode, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const {
  createBooking,
  cancelBooking,
  listSlots,
  runLottery,
  verifyLottery,
  pavilionWeekend,
  getActivity,
} = await import("./db.js");
const {
  listNotices,
  listUnreadNotices,
  markNoticeRead,
} = await import("./extra.js");

describe("backend crítico (PGlite)", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    assert.equal(getDbMode(), "pglite");
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reserva unha franxa libre e bloquea a segunda", async () => {
    const slots = await listSlots({
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-padel",
    });
    const now = new Date();
    /* cancelMinHours=2: a franxa ten que quedar a máis de 2 h para poder cancelar. */
    const minCancelMs = 2 * 3_600_000;
    const free = slots.find((s) => {
      if (s.occupied || s.closed) return false;
      const [h, m] = s.start.split(":").map(Number);
      const start = new Date(`${s.date}T00:00:00`);
      start.setHours(h ?? 0, m ?? 0, 0, 0);
      return start.getTime() - now.getTime() > minCancelMs;
    });
    assert.ok(free, "debe haber franxa futura libre no seed (>2 h)");

    const b1 = await createBooking({
      municipalityId: "muni-exemplo",
      slotId: free.id,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
    });
    assert.equal(b1.status, "confirmed");
    assert.match(b1.shortCode, /^PA-/);
    assert.ok(b1.qrPayload.includes(b1.id));
    assert.match(b1.id, /^[0-9a-f-]{36}$/i);

    await assert.rejects(
      () =>
        createBooking({
          municipalityId: "muni-exemplo",
          slotId: free.id,
          userId: "user-admin",
          userDisplayName: "Outra",
        }),
      /slot_occupied/,
    );

    await cancelBooking(b1.id, "user-cidada");
  });

  it("pavillón seed ten 1 par de conflito (Rev24 D9)", async () => {
    const data = await pavilionWeekend("muni-exemplo");
    assert.equal(data.conflicts, 1);
    assert.ok(data.matches.length >= 6);
  });

  it("sorteo verificable reproduce a orde", async () => {
    const before = await getActivity("act-multi");
    assert.ok(before?.lotterySeedHash, "hash publicado ao abrir inscricións");
    /* REVISION-56 H6: mapper oculta o segredo ata drawn; lelo da BD. */
    assert.equal(before?.lotterySecret, null);
    const raw = (
      await getDb()
        .select()
        .from(t.activities)
        .where(eq(t.activities.id, "act-multi"))
        .limit(1)
    )[0];
    assert.ok(raw?.lotterySecret, "segredo gardado (oculto na API)");

    const result = await runLottery("act-multi");
    assert.equal(result.activity.lotteryStatus, "drawn");
    assert.ok(result.accepted.length === 12);
    assert.ok(result.waitlist.length >= 1);
    assert.equal(result.activity.lotterySecret, raw.lotterySecret);

    const v = await verifyLottery("act-multi", result.activity.lotterySecret!);
    assert.equal(v.ok, true);
    assert.deepEqual(v.accepted, result.accepted);
    // Orde por nº de solicitude, non por id interno.
    assert.ok(result.accepted.every((n) => n.startsWith("req-")));
  });

  it("avisos: marcar lido persiste por usuario e sai de pendentes", async () => {
    const pendingBefore = await listUnreadNotices("muni-exemplo", "user-cidada");
    assert.ok(pendingBefore.length >= 1, "seed debe ter avisos pendentes");
    const target = pendingBefore[0]!;

    await markNoticeRead(target.id, "user-cidada");

    const pendingAfter = await listUnreadNotices("muni-exemplo", "user-cidada");
    assert.equal(
      pendingAfter.some((n) => n.id === target.id),
      false,
    );

    const all = await listNotices("muni-exemplo", "user-cidada");
    const marked = all.find((n) => n.id === target.id);
    assert.ok(marked);
    assert.equal(marked.read, true);
  });

  it("avisos: non permite marcar aviso alleo", async () => {
    await assert.rejects(
      () => markNoticeRead("n1", "user-admin"),
      /notice_forbidden/,
    );
  });
});
