/**
 * GobTec v3 — portabilidade: seasons / open_matches / user_roles + columnas novas.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-gobtec-port-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-gobtec-port";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  exportFullMunicipality,
  importMunicipalityDump,
} = await import("./muni-portability.js");
const { Hono } = await import("hono");
const { optionalAuth } = await import("../middleware/auth.js");
const { completeRoutes } = await import("../routes/complete.js");
const { createSession } = await import("../identity/sessions.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");
const t = await import("../db/schema.js");

describe("GobTec v3 muni-portability ampliada", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("exporta seasons/openMatches/userRoles e round-trip con slug novo", async () => {
    const db = getDb();
    await db.insert(t.seasons).values({
      id: "season-gobtec-1",
      municipalityId: "muni-proba",
      name: "Tempada proba",
      startsAt: "2026-09-01",
      endsAt: "2027-06-30",
      facilityIds: [],
      criteriaGl: "criterio",
      criteriaEs: "criterio",
      published: true,
    });
    await db
      .update(t.facilities)
      .set({
        outdoor: true,
        checkInRequired: true,
        openMatchesAllowed: true,
        imageAlt: "Pista de proba",
      })
      .where(eq(t.facilities.municipalityId, "muni-proba"));

    const [exFac] = await db
      .select()
      .from(t.facilities)
      .where(eq(t.facilities.municipalityId, "muni-proba"))
      .limit(1);
    const [exUnit] = await db
      .select()
      .from(t.units)
      .where(eq(t.units.municipalityId, "muni-proba"))
      .limit(1);
    const [exUser] = await db
      .select()
      .from(t.users)
      .where(eq(t.users.municipalityId, "muni-proba"))
      .limit(1);
    assert.ok(exFac && exUnit && exUser);

    await db.insert(t.openMatches).values({
      id: "om-gobtec-1",
      municipalityId: "muni-proba",
      facilityId: exFac.id,
      unitId: exUnit.id,
      organizerUserId: exUser.id,
      title: "Partido aberto proba",
      sport: "padel",
      date: "2027-01-15",
      start: "18:00",
      end: "19:00",
      spotsTotal: 4,
      status: "open",
      qrToken: "qr-om-gobtec-1",
    });
    await db.insert(t.openMatchPlayers).values({
      openMatchId: "om-gobtec-1",
      userId: exUser.id,
      displayName: exUser.displayName,
      role: "organizer",
      nameConsentAt: new Date("2026-11-14T10:00:00Z"),
    });
    await db
      .insert(t.userRoles)
      .values({
        userId: exUser.id,
        municipalityId: "muni-proba",
        role: "staff",
        clubId: "",
        active: true,
      })
      .onConflictDoNothing();
    /* Rol multi-concello dun usuario doutro concello (muni-exemplo) */
    await db
      .insert(t.userRoles)
      .values({
        userId: "user-cidada",
        municipalityId: "muni-proba",
        role: "citizen",
        clubId: "",
        active: true,
      })
      .onConflictDoNothing();

    const dump = await exportFullMunicipality("muni-proba");
    assert.ok(Array.isArray(dump.seasons));
    assert.ok(dump.seasons.some((s) => s.id === "season-gobtec-1"));
    assert.ok(dump.openMatches.some((om) => om.id === "om-gobtec-1"));
    assert.ok(dump.openMatchPlayers.some((p) => p.openMatchId === "om-gobtec-1"));
    assert.ok(dump.userRoles.length >= 2);
    assert.ok(
      dump.facilities.some(
        (f) => f.outdoor === true && f.imageAlt === "Pista de proba",
      ),
    );

    /* Cambiar emails/ids de persoas para non conflitar */
    dump.users = dump.users.map((u, i) => ({
      ...u,
      email: u.email ? `port-${i}-${u.email}` : null,
      personIdentifier: u.personIdentifier
        ? `PORT${i}${u.personIdentifier}`
        : null,
    }));

    const result = await importMunicipalityDump(dump, { slug: "port-gobtec" });
    assert.equal(result.slug, "port-gobtec");
    const seasons = await db
      .select()
      .from(t.seasons)
      .where(eq(t.seasons.municipalityId, result.municipalityId));
    assert.ok(seasons.some((s) => s.name === "Tempada proba"));
    const facs = await db
      .select()
      .from(t.facilities)
      .where(eq(t.facilities.municipalityId, result.municipalityId));
    assert.ok(facs.some((f) => f.outdoor === true && f.imageAlt === "Pista de proba"));
    const importedMatches = await db
      .select()
      .from(t.openMatches)
      .where(eq(t.openMatches.municipalityId, result.municipalityId));
    assert.ok(importedMatches.some((m) => m.title === "Partido aberto proba"));
    const importedRoles = await db
      .select()
      .from(t.userRoles)
      .where(eq(t.userRoles.municipalityId, result.municipalityId));
    assert.ok(importedRoles.length >= 2);
  });

  it("GET /api/me/datos exporta todas as coleccións RGPD da persoa", async () => {
    const app = new Hono();
    app.use("*", optionalAuth);
    app.route("/", completeRoutes);
    const cidada = SAML_DEMO_USERS["cidada"]!;
    const { key: _k, givenName: _g, familyName: _f, ...authUser } = cidada;
    const sid = await createSession(authUser);
    const res = await app.request("/api/me/datos", {
      headers: { Cookie: `pa_sesion=${sid}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: {
        user: { id: string };
        bookings: unknown[];
        userRoles: unknown[];
        activityApplications: unknown[];
        waitlistEntries: unknown[];
        incidents: unknown[];
        openMatches: {
          matches: unknown[];
          players: unknown[];
          invites: unknown[];
        };
      };
    };
    assert.equal(body.data.user.id, authUser.id);
    assert.ok(Array.isArray(body.data.bookings));
    assert.ok(Array.isArray(body.data.userRoles));
    assert.ok(Array.isArray(body.data.activityApplications));
    assert.ok(Array.isArray(body.data.waitlistEntries));
    assert.ok(Array.isArray(body.data.incidents));
    assert.ok(Array.isArray(body.data.openMatches.matches));
    assert.ok(Array.isArray(body.data.openMatches.players));
    assert.ok(Array.isArray(body.data.openMatches.invites));
  });

  it("acepta dump antigo sen seasons/openMatches (defaults)", async () => {
    const dump = await exportFullMunicipality("muni-proba");
    const legacy = { ...dump } as Record<string, unknown>;
    delete legacy.seasons;
    delete legacy.openMatches;
    delete legacy.openMatchPlayers;
    delete legacy.openMatchInvites;
    delete legacy.userRoles;
    legacy.users = (dump.users as typeof dump.users).map((u, i) => ({
      ...u,
      email: u.email ? `legacy-${i}@example.org` : null,
      personIdentifier: u.personIdentifier ? `LEG${i}${u.personIdentifier}` : null,
    }));
    const result = await importMunicipalityDump(legacy, { slug: "port-legacy" });
    assert.equal(result.slug, "port-legacy");
  });
});
