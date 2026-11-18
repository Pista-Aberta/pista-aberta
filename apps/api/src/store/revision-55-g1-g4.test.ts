/**
 * REVISION-55 G1–G4 — SAML demo roles, concello novo, rejectSwap, reservar-nome.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev55-g14-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-r55-g14";
delete process.env.PA_DEMO;
delete process.env.PA_SINGLE_MUNI;
delete process.env.VITE_PA_SINGLE_MUNI;
process.env.NODE_ENV = "test";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { profileToAuthUser } = await import("../identity/saml-sp.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");
const {
  proposeSwap,
  rejectSwap,
  acceptSwapProposal,
} = await import("./db.js");
const { createSession } = await import("../identity/sessions.js");
const { completeRoutes } = await import("../routes/complete.js");
const { optionalAuth } = await import("../middleware/auth.js");
const t = await import("../db/schema.js");

const EIDAS_PI =
  "http://eidas.europa.eu/attributes/naturalperson/PersonIdentifier";

function buildApp() {
  const app = new Hono();
  app.use("*", optionalAuth);
  app.route("/", completeRoutes);
  return app;
}

describe("REVISION-55 G1–G4", () => {
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

  it("G1: NODE_ENV=production sen PA_DEMO → DNI demo = cidadán novo", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevDemo = process.env.PA_DEMO;
    const prevSingle = process.env.PA_SINGLE_MUNI;
    process.env.NODE_ENV = "production";
    delete process.env.PA_DEMO;
    process.env.PA_SINGLE_MUNI = "exemplo";
    try {
      /* Simular BD sen esas persoas (o fallo é o fallback a SAML_DEMO_USERS). */
      for (const pi of ["ES/ES/33445566R", "ES/ES/11223344B"] as const) {
        await getDb()
          .update(t.users)
          .set({ personIdentifier: null })
          .where(eq(t.users.personIdentifier, pi));
        const user = await profileToAuthUser(
          { [EIDAS_PI]: pi, nameID: pi },
          { relayState: "/c/exemplo/acceso" },
        );
        assert.equal(user.role, "citizen", pi);
        assert.equal(user.personIdentifier, pi);
        assert.notEqual(user.id, SAML_DEMO_USERS.deputacion?.id);
        assert.notEqual(user.id, SAML_DEMO_USERS.admin?.id);
      }
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevDemo === undefined) delete process.env.PA_DEMO;
      else process.env.PA_DEMO = prevDemo;
      if (prevSingle === undefined) delete process.env.PA_SINGLE_MUNI;
      else process.env.PA_SINGLE_MUNI = prevSingle;
    }
  });

  it("G2: PA_SINGLE_MUNI=terceiro → Cl@ve novo queda en muni-terceiro", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevDemo = process.env.PA_DEMO;
    const prevSingle = process.env.PA_SINGLE_MUNI;
    process.env.NODE_ENV = "production";
    delete process.env.PA_DEMO;
    process.env.PA_SINGLE_MUNI = "terceiro";
    try {
      const existing = await getDb()
        .select({ id: t.municipalities.id })
        .from(t.municipalities)
        .where(eq(t.municipalities.slug, "terceiro"))
        .limit(1);
      const outesId = existing[0]?.id ?? "muni-terceiro-r55";
      if (!existing[0]) {
        await getDb().insert(t.municipalities).values({
          id: outesId,
          slug: "terceiro",
          name: "Terceiro",
          accentColor: "#5A4636",
          locales: ["gl", "es"],
          settings: {
            maxHoursPerWeek: 4,
            bookingAntelationDays: 7,
          },
        });
      }
      const user = await profileToAuthUser(
        {
          [EIDAS_PI]: "ES/ES/88776655K",
          nameID: "ES/ES/88776655K",
        },
        { relayState: "/" },
      );
      assert.equal(user.role, "citizen");
      assert.equal(user.municipalityId, outesId);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevDemo === undefined) delete process.env.PA_DEMO;
      else process.env.PA_DEMO = prevDemo;
      if (prevSingle === undefined) delete process.env.PA_SINGLE_MUNI;
      else process.env.PA_SINGLE_MUNI = prevSingle;
    }
  });

  it("G3: club alleo → 403; swap aceptado → 409 not_pending", async () => {
    const mid = "muni-exemplo";
    /* m1 = basquet, m2 = volei (semente). */
    const swap = await proposeSwap({
      municipalityId: mid,
      fromMatchId: "m1",
      toMatchId: "m2",
      actorClubId: "club-basquet",
      actorRole: "club_manager",
    });
    await assert.rejects(
      () =>
        rejectSwap(swap.id, mid, {
          actorClubId: "club-patin",
          actorRole: "club_manager",
        }),
      /forbidden/,
    );
    await acceptSwapProposal(swap.id, mid, {
      actorClubId: "club-volei",
      actorRole: "club_manager",
    });
    await assert.rejects(
      () =>
        rejectSwap(swap.id, mid, {
          actorClubId: "club-volei",
          actorRole: "club_manager",
        }),
      /not_pending/,
    );
  });

  it("G4: admin Proba + citizenId Ana → 404 e teléfono sen cambiar", async () => {
    const ana = (
      await getDb()
        .select()
        .from(t.users)
        .where(eq(t.users.id, "user-cidada"))
        .limit(1)
    )[0]!;
    const phoneBefore = ana.phone ?? null;

    const adminEx = SAML_DEMO_USERS["admin-proba"];
    assert.ok(adminEx, "admin proba na demo");
    const { key: _k, givenName: _g, familyName: _f, ...rest } = adminEx;
    const sid = await createSession(rest);

    /* Franxa calquera de Proba se existe; se non, a chamada falla por slot
       pero o 404 de user debe ir antes. */
    const res = await app.request("/api/c/proba/admin/reservar-nome", {
      method: "POST",
      headers: {
        Cookie: `pa_sesion=${sid}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slotId: "slot-inexistente-g4",
        citizenName: "Ana Demo",
        citizenId: "user-cidada",
        phone: "600000000",
      }),
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "user_not_found");

    const anaAfter = (
      await getDb()
        .select()
        .from(t.users)
        .where(eq(t.users.id, "user-cidada"))
        .limit(1)
    )[0]!;
    assert.equal(anaAfter.phone ?? null, phoneBefore);
  });
});
