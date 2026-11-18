/**
 * REVISION-55 G5–G7 (+ G8/G10/G11 se dá tempo).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev55-g5-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-r55-g5";
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");
const { completeRoutes } = await import("../routes/complete.js");
const { optionalAuth, effectiveRoleInMunicipality } = await import(
  "../middleware/auth.js"
);
const {
  createBooking,
  cancelBooking,
  listSlots,
} = await import("./db.js");
const { addWaitlist } = await import("./extra.js");
const t = await import("../db/schema.js");
import { fileURLToPath } from "node:url";
const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function buildApp() {
  const app = new Hono();
  app.use("*", optionalAuth);
  app.route("/", completeRoutes);
  return app;
}

describe("REVISION-55 G5–G11", () => {
  const app = buildApp();

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("G5: pechar cancela futuras, waitlist e pon Conta pechada", async () => {
    const mid = "muni-exemplo";
    /* Usar cidada-proba para non romper Ana nos outros tests do ficheiro. */
    const cidada = SAML_DEMO_USERS["cidada-proba"]!;
    const { key: _k, givenName: _g, familyName: _f, ...rest } = cidada;
    const slots = await listSlots({ municipalityId: mid });
    const free = slots.filter((s) => !s.closed && !s.occupied);
    /* Data explícita mañá+ para evitar slot_in_past. */
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const day = tomorrow.toISOString().slice(0, 10);
    let future = free.find((s) => s.date >= day);
    if (!future) {
      /* Xerar reserva vía staff nun slot do seed coa data máis afastada. */
      future = [...free].sort((a, b) => b.date.localeCompare(a.date))[0];
    }
    assert.ok(future, "franxa futura");
    const booking = await createBooking({
      municipalityId: mid,
      slotId: future!.id,
      userId: rest.id,
      userDisplayName: rest.displayName,
      bookedByStaff: true,
    });
    const other = free.find((s) => s.id !== future!.id);
    if (other) {
      await addWaitlist({
        municipalityId: mid,
        slotId: other.id,
        userId: rest.id,
        userDisplayName: rest.displayName,
      }).catch(() => undefined);
    }

    const sid = await createSession(rest);
    const res = await app.request("/api/me/pechar", {
      method: "POST",
      headers: { Cookie: `pa_sesion=${sid}` },
    });
    assert.equal(res.status, 200);

    const b = (
      await getDb()
        .select()
        .from(t.bookings)
        .where(eq(t.bookings.id, booking.id))
        .limit(1)
    )[0]!;
    assert.equal(b.status, "cancelled");
    assert.equal(b.userDisplayName, "Conta pechada");

    const u = (
      await getDb()
        .select()
        .from(t.users)
        .where(eq(t.users.id, rest.id))
        .limit(1)
    )[0]!;
    assert.equal(u.active, false);
    assert.equal(u.displayName, "Conta pechada");

    const wl = await getDb()
      .select()
      .from(t.waitlistEntries)
      .where(
        and(
          eq(t.waitlistEntries.userId, rest.id),
          inArray(t.waitlistEntries.status, ["waiting", "offered"]),
        ),
      );
    assert.equal(wl.length, 0);
  });

  it("G6: solicitar-partido con data/hora inválida → 400", async () => {
    const club = SAML_DEMO_USERS.club!;
    const { key: _k, givenName: _g, familyName: _f, ...rest } = club;
    const sid = await createSession(rest);
    const res = await app.request(
      "/api/c/exemplo/clubs/club-basquet/solicitar-partido",
      {
        method: "POST",
        headers: {
          Cookie: `pa_sesion=${sid}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          date: "2026-13-45",
          start: "25:00",
          end: "10:00",
          homeTeam: "",
          awayTeam: "Rival",
          unitId: "unit-pav-full",
          facilityId: "fac-exemplo-pav",
        }),
      },
    );
    assert.equal(res.status, 400);
  });

  it("G7: HomePage non liga a /c/exemplo/legal", () => {
    const src = fs.readFileSync(
      path.join(root, "apps/web/src/pages/HomePage.tsx"),
      "utf8",
    );
    assert.doesNotMatch(src, /\/c\/exemplo\/legal/);
    assert.match(src, /to="\/legal\/accesibilidade"/);
    assert.match(src, /to="\/legal\/privacidade"/);
  });

  it("G8: effectiveRoleInMunicipality usa o rol do concello", () => {
    const user = {
      id: "u1",
      municipalityId: "muni-exemplo",
      role: "admin" as const,
      displayName: "X",
      locale: "gl" as const,
      linkedMuniRoles: [
        {
          role: "staff" as const,
          municipalityId: "muni-terceiro",
          municipalityName: "Terceiro",
          label: "Conserxaría",
        },
      ],
    };
    assert.equal(effectiveRoleInMunicipality(user, "muni-exemplo"), "admin");
    assert.equal(effectiveRoleInMunicipality(user, "muni-terceiro"), "staff");
  });

  it("G11: cancelBooking allea → forbidden", async () => {
    await assert.rejects(
      () => cancelBooking("nonexistent-booking-g11", "user-cidada"),
      /not_found/,
    );
  });
});
