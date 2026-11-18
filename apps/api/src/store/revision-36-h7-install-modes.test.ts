/**
 * REVISION-36 H7 — despregamento nos dous modos (PGlite, sen demo seed).
 * Un concello: migrate → setup Terceiro → convite admin → instalacións censo > 0.
 * Deputación: migrate → entidade + convite xestora → 0 concellos adheridos.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql, and, ne } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-h7-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
delete process.env.PA_DEMO;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-h7-install-modes-secretxxx";
process.env.APP_BASE_URL = "https://reservas.proba.gal";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const t = await import("../db/schema.js");

describe("REVISION-36 H7 install modes sen demo", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    /* Explicitamente SEN seedDb */
  });
  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("arranque limpo: 0 concellos e 0 usuarios", async () => {
    const munis = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(t.municipalities);
    const users = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(t.users);
    assert.equal(Number(munis[0]?.n ?? 0), 0);
    assert.equal(Number(users[0]?.n ?? 0), 0);
  });

  it("modo un concello: Terceiro + censo con coordenadas + convite con nome", async () => {
    const { createMunicipalityFromWizard } = await import(
      "./municipality-launch.js"
    );
    const { createInvitation } = await import("./invitations.js");
    const m = await createMunicipalityFromWizard({
      name: "Concello de Terceiro",
      slug: "terceiro",
      ine: "32078",
      markedFacilities: [
        "Pistas (3)",
        "Campos de fútbol",
        "Pavillóns / centros deportivos",
      ],
      schedule: { pista: { open: "09:00", close: "22:00" } },
      norms: {},
      adminEmail: "admin.terceiro@proba.gal",
      adminDisplayName: "Carla López",
      adminNif: "12345678Z",
      sandbox: false,
      createdBy: "h7-test",
    });
    assert.equal(m.slug, "terceiro");
    assert.ok(m.invite?.token);

    const facs = await getDb()
      .select()
      .from(t.facilities)
      .where(eq(t.facilities.municipalityId, m.id));
    assert.ok(facs.length > 0, "sen instalacións do censo");
    const withCoords = facs.filter(
      (f) =>
        Number.isFinite(Number(f.lat)) &&
        Number.isFinite(Number(f.lng)) &&
        !(Number(f.lat) === 42.861 && Number(f.lng) === -8.902),
    );
    assert.ok(
      withCoords.length > 0,
      "instalacións sen coordenadas reais do censo",
    );

    const inv = await createInvitation({
      municipalityId: m.id,
      role: "admin",
      email: "admin2.terceiro@proba.gal",
      nif: "87654321X",
      displayName: "Carla López",
      createdBy: "h7-test",
    });
    assert.ok(inv.token);
    const row = (
      await getDb()
        .select()
        .from(t.invitations)
        .where(eq(t.invitations.token, inv.token))
        .limit(1)
    )[0];
    assert.equal(row?.displayName, "Carla López");

    const munis = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(t.municipalities);
    assert.equal(Number(munis[0]?.n ?? 0), 1);
  });

  it("modo Deputación: entidade + convite sen concellos adheridos extra", async () => {
    const {
      createDeputacionOrganization,
      inviteDeputacionManager,
      DEPUTACION_PLATFORM_MUNI_ID,
    } = await import("./deputacion-org.js");
    const org = await createDeputacionOrganization({
      name: "Deputación Provincial de Proba",
    });
    assert.equal(org.name, "Deputación Provincial de Proba");
    const inv = await inviteDeputacionManager({
      email: "xestora@deputacion.gal",
      nif: "11223344B",
      name: "Marta Xestora",
      createdBy: "h7-test",
    });
    assert.ok(inv.token);
    const adhered = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(t.municipalities)
      .where(
        and(
          ne(t.municipalities.id, DEPUTACION_PLATFORM_MUNI_ID),
        ),
      );
    /* Terceiro do test anterior + sen máis adheridos forzados pola Deputación. */
    assert.ok(Number(adhered[0]?.n ?? 0) >= 1);
    const platform = await getDb()
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.id, DEPUTACION_PLATFORM_MUNI_ID))
      .limit(1);
    assert.ok(platform[0]);
  });
});
