/**
 * REVISION-42 Q6 — nome amosable cando o da sesión é o local-part do correo.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";
import {
  assertDisplayNameForMatch,
  isEmailLocalPartName,
} from "@pista-aberta/shared";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r42-q6-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-42-q6";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBookingWithOpenMatch, joinOpenMatch } = await import(
  "./open-matches.js"
);
const t = await import("../db/schema.js");

const mid = "muni-exemplo";
let slotSeq = 0;

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
  slotSeq += 1;
  const id = `slot-q6-${slotSeq}-${Date.now().toString(36)}`;
  await getDb()
    .insert(t.timeSlots)
    .values({
      id,
      unitId: "unit-padel-1",
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
        eq(t.timeSlots.unitId, "unit-padel-1"),
        eq(t.timeSlots.date, opts.date),
        eq(t.timeSlots.start, opts.start),
      ),
    )
    .limit(1);
  assert.ok(hit[0]);
  return hit[0]!.id;
}

before(async () => {
  await initDb();
  await migrateSchema();
  await seedDb();
});

after(async () => {
  await closeDb();
});

describe("REVISION-42 Q6 helpers", () => {
  it("isEmailLocalPartName detecta OTP", () => {
    assert.equal(isEmailLocalPartName("draft42", "draft42@proba.gal"), true);
    assert.equal(
      isEmailLocalPartName("pablo.lopez.nunez", "pablo.lopez.nunez@x.gal"),
      true,
    );
    assert.equal(isEmailLocalPartName("Ana Demo", "draft42@proba.gal"), false);
  });

  it("assertDisplayNameForMatch rexeita o local-part", () => {
    assert.throws(
      () => assertDisplayNameForMatch("draft42", "draft42@x.gal"),
      /display_name_required/,
    );
    assert.equal(
      assertDisplayNameForMatch("Ana Demo", "draft42@x.gal"),
      "Ana Demo",
    );
  });
});

describe("REVISION-42 Q6 API create/join", () => {
  it("crear partido con nome de correo → display_name_required", async () => {
    const otpId = "otp-q6-create@demo.pistaaberta.com";
    await getDb()
      .insert(t.users)
      .values({
        id: otpId,
        municipalityId: mid,
        role: "citizen",
        displayName: "q6create",
        email: "q6create@demo.pistaaberta.com",
        locale: "gl",
      })
      .onConflictDoUpdate({
        target: t.users.id,
        set: {
          displayName: "q6create",
          email: "q6create@demo.pistaaberta.com",
        },
      });

    const slotId = await insertSlot({
      date: nearDate(2),
      start: "03:00",
      end: "04:00",
    });

    await assert.rejects(
      () =>
        createBookingWithOpenMatch({
          municipalityId: mid,
          slotId,
          userId: otpId,
          displayName: "q6create",
          email: "q6create@demo.pistaaberta.com",
          title: "Partido Q6",
          nameDisplayConsent: true,
        }),
      /display_name_required/,
    );

    const { booking, match } = await createBookingWithOpenMatch({
      municipalityId: mid,
      slotId,
      userId: otpId,
      displayName: "q6create",
      email: "q6create@demo.pistaaberta.com",
      title: "Partido Q6 ok",
      nameDisplayConsent: true,
      proposedDisplayName: "Lara Miguez",
    });
    assert.ok(match.id);
    assert.equal(booking.userDisplayName, "Lara Miguez");
    const [u] = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.id, otpId))
      .limit(1);
    assert.equal(u?.displayName, "Lara Miguez");
  });

  it("apuntarse con nome de correo → display_name_required", async () => {
    const org = "user-cidada";
    const otpId = "otp-q6-join@demo.pistaaberta.com";
    await getDb()
      .insert(t.users)
      .values({
        id: otpId,
        municipalityId: mid,
        role: "citizen",
        displayName: "q6join",
        email: "q6join@demo.pistaaberta.com",
        locale: "gl",
      })
      .onConflictDoUpdate({
        target: t.users.id,
        set: { displayName: "q6join", email: "q6join@demo.pistaaberta.com" },
      });

    const slotId = await insertSlot({
      date: nearDate(3),
      start: "03:00",
      end: "04:00",
    });
    const { match } = await createBookingWithOpenMatch({
      municipalityId: mid,
      slotId,
      userId: org,
      displayName: "Ana Demo",
      email: "ana.demo@demo.pistaaberta.com",
      title: "Partido join Q6",
      spotsTotal: 4,
      nameDisplayConsent: true,
    });

    await assert.rejects(
      () =>
        joinOpenMatch({
          municipalityId: mid,
          openMatchId: match.id,
          userId: otpId,
          displayName: "q6join",
          email: "q6join@demo.pistaaberta.com",
          nameDisplayConsent: true,
        }),
      /display_name_required/,
    );

    const joined = await joinOpenMatch({
      municipalityId: mid,
      openMatchId: match.id,
      userId: otpId,
      displayName: "q6join",
      email: "q6join@demo.pistaaberta.com",
      nameDisplayConsent: true,
      proposedDisplayName: "Noa Perez",
    });
    assert.ok(joined.players.some((p) => /Noa/.test(p.displayName)));
  });
});
