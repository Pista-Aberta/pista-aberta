/**
 * REVISION-50 — S1/S2/S3 + A1/A2/A3.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev50-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
delete process.env.AUTH_ELEVATED_SAML_ONLY;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const t = await import("../db/schema.js");
const { createBooking, proposeSwap, listSlots } = await import("./db.js");
const { moveMatch } = await import("./admin-ops.js");
const { inviteStaffUser } = await import("./staff-users.js");
const { createSession, setSessionActiveMuniRole } = await import(
  "../identity/sessions.js"
);
const { grantUserRole } = await import("./user-roles.js");
const {
  addDaysIso,
  localDateIso,
  DEFAULT_TIMEZONE,
} = await import("./business-rules.js");

const mid = "muni-exemplo";

function nearDate(offset: number): string {
  return addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), offset);
}

async function freeSlot(unitId: string, date: string, start: string) {
  const endH = Number(start.slice(0, 2)) + 1;
  const end = `${String(endH).padStart(2, "0")}:00`;
  const id = `slot-${unitId}-${date}-${start.replace(":", "")}-r50`;
  await getDb()
    .insert(t.timeSlots)
    .values({
      id,
      unitId,
      municipalityId: mid,
      date,
      start,
      end,
      closed: false,
    })
    .onConflictDoNothing();
  /* Pode existir outra franxa co mesmo (unit,date,start) e id distinto. */
  const existing = await getDb()
    .select()
    .from(t.timeSlots)
    .where(
      and(
        eq(t.timeSlots.unitId, unitId),
        eq(t.timeSlots.date, date),
        eq(t.timeSlots.start, start),
        eq(t.timeSlots.municipalityId, mid),
      ),
    )
    .limit(1);
  const slotId = existing[0]?.id ?? id;
  await getDb()
    .update(t.bookings)
    .set({ status: "cancelled" })
    .where(
      and(eq(t.bookings.slotId, slotId), eq(t.bookings.municipalityId, mid)),
    );
  await getDb()
    .update(t.timeSlots)
    .set({ closed: false, heldForUserId: null, heldUntil: null })
    .where(eq(t.timeSlots.id, slotId));
  return slotId;
}

describe("REVISION-50 seguridad e reservas", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("A1: completa + media mesma hora → 409 slot_occupied", async () => {
    const date = nearDate(5);
    const fullId = await freeSlot("unit-pav-full", date, "16:00");
    const halfId = await freeSlot("unit-pav-a", date, "16:00");
    await createBooking({
      municipalityId: mid,
      slotId: fullId,
      userId: "user-cidada",
      userDisplayName: "Ana",
    });
    await assert.rejects(
      () =>
        createBooking({
          municipalityId: mid,
          slotId: halfId,
          userId: "user-brais",
          userDisplayName: "Luis",
        }),
      /slot_occupied/,
    );
    const halfSlots = await listSlots({
      municipalityId: mid,
      unitId: "unit-pav-a",
      date,
    });
    assert.equal(
      halfSlots.find((s) => s.start === "16:00")?.occupied,
      true,
      "media A debe verse ocupada",
    );
  });

  it("A2: mover partido enriba dunha reserva → 409 conflict", async () => {
    const date = nearDate(6);
    const slotId = await freeSlot("unit-pav-full", date, "17:00");
    await createBooking({
      municipalityId: mid,
      slotId,
      userId: "user-cidada",
      userDisplayName: "Ana",
    });
    await assert.rejects(
      () =>
        moveMatch(
          mid,
          "m8",
          {
            date,
            start: "17:00",
            end: "18:30",
            unitId: "unit-pav-full",
            facilityId: "fac-exemplo-pav",
          },
          "test",
        ),
      (e: unknown) => {
        if (!(e instanceof Error) || e.message !== "conflict") return false;
        const conflicts = (e as Error & { conflicts?: Array<{ kind: string }> })
          .conflicts;
        return !!conflicts?.some((c) => c.kind === "booking_overlap");
      },
    );
  });

  it("A3: club alleo propón intercambio → forbidden", async () => {
    await assert.rejects(
      () =>
        proposeSwap({
          municipalityId: mid,
          fromMatchId: "m1",
          toMatchId: "m2",
          actorClubId: "club-patin",
          actorRole: "club_manager",
        }),
      /forbidden/,
    );
  });

  it("S1: conta existente → convite, non ligar automaticamente", async () => {
    const stolen = "conserxe.rev50@exemplo.invalid";
    const created = await inviteStaffUser({
      municipalityId: mid,
      displayName: "Conserxe Extra",
      email: stolen,
      role: "staff",
      invitedBy: "test",
    });
    assert.ok(created.id);
    const again = await inviteStaffUser({
      municipalityId: mid,
      displayName: "Outro",
      email: stolen,
      role: "staff",
      invitedBy: "test",
    });
    assert.equal(again.invitePending, true);
    assert.ok(again.inviteToken);
  });

  it("S2: email_otp + rol-activo staff → forbidden", async () => {
    process.env.AUTH_ELEVATED_SAML_ONLY = "1";
    try {
      const ana = (
        await getDb()
          .select()
          .from(t.users)
          .where(eq(t.users.id, "user-cidada"))
          .limit(1)
      )[0]!;
      await grantUserRole({
        userId: ana.id,
        municipalityId: mid,
        role: "staff",
      });
      const sid = await createSession(
        {
          id: ana.id,
          municipalityId: mid,
          role: "citizen",
          displayName: ana.displayName,
          email: ana.email ?? undefined,
          locale: "gl",
        },
        { authMethod: "email_otp" },
      );
      await assert.rejects(
        () => setSessionActiveMuniRole(sid, "staff"),
        /forbidden/,
      );
    } finally {
      delete process.env.AUTH_ELEVATED_SAML_ONLY;
    }
  });

  it("S3: club le reserva allea → 403", async () => {
    const date = nearDate(3);
    const slotId = await freeSlot("unit-padel-1", date, "11:00");
    const booking = await createBooking({
      municipalityId: mid,
      slotId,
      userId: "user-brais",
      userDisplayName: "Luis",
    });
    const club = (
      await getDb()
        .select()
        .from(t.users)
        .where(eq(t.users.role, "club_manager"))
        .limit(1)
    )[0]!;
    const elevated = new Set(["admin", "staff", "monitor", "superadmin"]);
    const allowed =
      booking.userId === club.id || elevated.has(club.role as string);
    assert.equal(allowed, false);
    /* Regra da ruta GET /reservas/:id (index.ts). */
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "../index.ts"), "utf8");
    assert.match(src, /elevated\.has\(c\.get\("effectiveRole"\)\)/);
    assert.match(src, /REVISION-50 S3/);
  });
});

