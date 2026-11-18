import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@pista-aberta/shared";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-p2-account-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-p2-account";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { closeCitizenAccount } = await import("./close-account.js");
const { anonymizePastBookings } = await import("./db.js");

const closingUser: AuthUser = {
  id: "user-cidada-proba",
  municipalityId: "muni-exemplo",
  role: "citizen",
  displayName: "Persoa de proba",
  locale: "gl",
};

async function insertBooking(input: {
  id: string;
  userId: string;
  date: string;
  slotId: string;
}) {
  await getDb().insert(t.timeSlots).values({
    id: input.slotId,
    unitId: "unit-padel-1",
    municipalityId: "muni-exemplo",
    date: input.date,
    start: "10:00",
    end: "11:00",
  });
  await getDb().insert(t.bookings).values({
    id: input.id,
    municipalityId: "muni-exemplo",
    unitId: "unit-padel-1",
    facilityId: "fac-exemplo-padel",
    userId: input.userId,
    userDisplayName: "Persoa de proba",
    slotId: input.slotId,
    date: input.date,
    start: "10:00",
    end: "11:00",
    status: "confirmed",
    shortCode: `PA-${input.id}`,
    qrPayload: `qr-${input.id}`,
  });
}

describe("auditoría P2.4/P2.5 — peche e anonimización", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reverte todo se falla a segunda cancelación", async () => {
    await insertBooking({
      id: "p2-close-booking-1",
      userId: closingUser.id,
      date: "2099-06-01",
      slotId: "p2-close-slot-1",
    });
    await insertBooking({
      id: "p2-close-booking-2",
      userId: closingUser.id,
      date: "2099-06-02",
      slotId: "p2-close-slot-2",
    });

    await assert.rejects(
      closeCitizenAccount(closingUser, {
        beforeCancel: (_bookingId, index) => {
          if (index === 1) throw new Error("injected_cancel_failure");
        },
      }),
      /injected_cancel_failure/,
    );

    const bookings = await getDb()
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.userId, closingUser.id));
    assert.equal(bookings.length, 2);
    assert.deepEqual(
      bookings.map((booking) => booking.status).sort(),
      ["confirmed", "confirmed"],
    );
    const [user] = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.id, closingUser.id));
    assert.equal(user?.active, true);
  });

  it("pecha de forma atómica e repetir o peche non cambia o resultado", async () => {
    await closeCitizenAccount(closingUser);
    await closeCitizenAccount(closingUser);

    const retained = await getDb()
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.id, "p2-close-booking-1"));
    assert.equal(retained[0]?.status, "cancelled");
    assert.equal(retained[0]?.userId, null);
    const [user] = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.id, closingUser.id));
    assert.equal(user?.active, false);
  });

  it("unha reserva caducada anonimizada non se pode unir coa persoa", async () => {
    await insertBooking({
      id: "p2-expired-booking",
      userId: "user-cidada",
      date: "2020-01-01",
      slotId: "p2-expired-slot",
    });

    const changed = await anonymizePastBookings(new Date("2026-11-13T12:00:00Z"));
    assert.ok(changed >= 1);

    const [booking] = await getDb()
      .select()
      .from(t.bookings)
      .where(eq(t.bookings.id, "p2-expired-booking"));
    assert.equal(booking?.userId, null);
    assert.equal(booking?.userDisplayName, "Anonimizado");

    const joined = await getDb()
      .select({ personId: t.users.id })
      .from(t.bookings)
      .leftJoin(t.users, eq(t.bookings.userId, t.users.id))
      .where(eq(t.bookings.id, "p2-expired-booking"));
    assert.equal(joined[0]?.personId, null);
  });

  it("borra family_members e sessions ao pechar", async () => {
    const uid = "user-cidada";
    await getDb().insert(t.familyMembers).values({
      id: "fam-close-test-1",
      userId: uid,
      municipalityId: "muni-exemplo",
      displayName: "Menor de proba",
      birthYear: 2015,
      relation: "fillo",
    });
    await getDb().insert(t.sessions).values({
      id: "sess-close-test-1",
      userId: uid,
      expiresAt: new Date(Date.now() + 86400000),
    });
    const beforeFam = await getDb()
      .select()
      .from(t.familyMembers)
      .where(eq(t.familyMembers.userId, uid));
    assert.ok(beforeFam.length >= 1);
    await closeCitizenAccount({
      id: uid,
      municipalityId: "muni-exemplo",
      role: "citizen",
      displayName: "Cidada",
      locale: "gl",
    });
    const fam = await getDb()
      .select()
      .from(t.familyMembers)
      .where(eq(t.familyMembers.userId, uid));
    assert.equal(fam.length, 0);
    const sess = await getDb()
      .select()
      .from(t.sessions)
      .where(eq(t.sessions.userId, uid));
    assert.equal(sess.length, 0);
  });
});
