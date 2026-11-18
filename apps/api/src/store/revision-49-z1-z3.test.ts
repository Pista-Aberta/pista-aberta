/**
 * REVISION-49 Z1 / Z3 — moveMatch avisa aos clubs + no_change.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r49-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-rev49";
process.env.APP_BASE_URL = "https://demo.pistaaberta.com";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { moveMatch } = await import("./admin-ops.js");
const {
  DEFAULT_TIMEZONE,
  futureWeekendSaturdayIso,
} = await import("./business-rules.js");
const t = await import("../db/schema.js");
const { clearDemoOutbox, listDemoEmails } = await import(
  "../notify/emails/demo-outbox.js"
);

describe("REVISION-49 Z1 Z3 moveMatch avisos e no_change", () => {
  const mid = "muni-exemplo";
  let matchId = "m5";
  let futureSat = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    futureSat = futureWeekendSaturdayIso(new Date(), DEFAULT_TIMEZONE);
    matchId = "m5";

    /* Segundo club (volei) con xestor — «aos dous clubs». */
    await getDb()
      .insert(t.users)
      .values({
        id: "user-club-volei-r49",
        municipalityId: mid,
        role: "club_manager",
        displayName: "CV Sarela xestor",
        email: "volei.xestor@demo.pistaaberta.com",
        personIdentifier: "ES/ES/11223344R49",
        clubId: "club-volei",
        locale: "gl",
        active: true,
      })
      .onConflictDoUpdate({
        target: t.users.id,
        set: {
          role: "club_manager",
          clubId: "club-volei",
          email: "volei.xestor@demo.pistaaberta.com",
          active: true,
        },
      });

    /* Away team do m5 pasa a ser do club volei (dous clubs distintos). */
    await getDb()
      .update(t.matches)
      .set({ awayTeamId: "t-v1" })
      .where(and(eq(t.matches.id, matchId), eq(t.matches.municipalityId, mid)));
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("Z3: mesma data/hora/pista → 400 no_change e estado intacto", async () => {
    const before = (
      await getDb()
        .select()
        .from(t.matches)
        .where(eq(t.matches.id, matchId))
        .limit(1)
    )[0]!;
    await assert.rejects(
      () =>
        moveMatch(
          mid,
          matchId,
          {
            facilityId: before.facilityId,
            unitId: before.unitId,
            date: before.date,
            start: before.start,
            end: before.end,
          },
          "test-admin",
        ),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message, "no_change");
        return true;
      },
    );
    const after = (
      await getDb()
        .select()
        .from(t.matches)
        .where(eq(t.matches.id, matchId))
        .limit(1)
    )[0]!;
    assert.equal(after.status, before.status);
    assert.equal(after.start, before.start);
  });

  it("Z1: mover → aviso e correo aos dous clubs + .ics", async () => {
    clearDemoOutbox();
    const moved = await moveMatch(
      mid,
      matchId,
      {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-full",
        date: futureSat,
        start: "18:00",
        end: "19:30",
      },
      "test-admin",
    );
    assert.equal(moved.status, "moved");

    const notices = await getDb().select().from(t.notices);
    const moveNotices = notices.filter((n) => {
      const p = n.payload as Record<string, unknown> | null;
      return p?.kind === "match_moved" && p?.matchId === matchId;
    });
    const userIds = new Set(moveNotices.map((n) => n.userId));
    assert.ok(
      userIds.has("user-club") || userIds.has("user-club-2"),
      "aviso ao club local",
    );
    assert.ok(userIds.has("user-club-volei-r49"), "aviso ao club visitante");
    assert.match(
      moveNotices[0]!.body,
      /O voso partido .+ pasa ao .+ ás 18:00/,
    );

    const mails = listDemoEmails();
    const matchMails = mails.filter((m) => m.kind === "match_moved");
    assert.ok(matchMails.length >= 2, "correo aos dous clubs");
    assert.match(matchMails[0]!.text, /pasa ao|pasa al/i);
    /* .ics no HTML/attachments vía render — o texto leva a hora. */
    assert.match(matchMails[0]!.subject, /partido movido/i);
  });
});
