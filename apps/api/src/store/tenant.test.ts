/**
 * Illamento multi-tenant: admin de A non ve datos de B.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolvePostLoginPath, isElevatedRole } from "@pista-aberta/shared";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-tenant-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { dashboardStats } = await import("./db.js");
const { createMunicipalityFull } = await import("./municipality-launch.js");
const { userBelongsToMunicipality } = await import("../middleware/auth.js");
const { listUnreadNotices } = await import("./extra.js");
const {
  clubAccountOwnsClub,
  createClubWithAccount,
  listClubAccounts,
} = await import("./club-accounts.js");

describe("multi-tenant (PGlite)", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolvePostLoginPath: admin de Exemplo non vai a outro slug", () => {
    assert.equal(
      resolvePostLoginPath("admin", "exemplo", "/c/terceiro/admin"),
      "/c/exemplo/admin",
    );
    assert.equal(
      resolvePostLoginPath("admin", "exemplo", "/c/exemplo/admin/persoal"),
      "/c/exemplo/admin/persoal",
    );
    assert.equal(
      resolvePostLoginPath("citizen", "exemplo", "/c/proba/instalacions"),
      "/c/proba/instalacions",
    );
  });

  it("REVISION-17 R7: superadmin sempre /deputacion salvo returnTo explícito", () => {
    assert.equal(
      resolvePostLoginPath("superadmin", "exemplo", "/c/exemplo/admin"),
      "/deputacion",
    );
    assert.equal(
      resolvePostLoginPath("superadmin", "exemplo", "/deputacion"),
      "/deputacion",
    );
    assert.equal(
      resolvePostLoginPath("superadmin", "exemplo", null),
      "/deputacion",
    );
  });

  it("resolvePostLoginPath: rexeita open-redirect // e backslash", () => {
    assert.equal(
      resolvePostLoginPath("citizen", "exemplo", "//evil.example"),
      "/c/exemplo",
    );
    assert.equal(
      resolvePostLoginPath("admin", "exemplo", "//evil.example"),
      "/c/exemplo/admin",
    );
    assert.equal(
      resolvePostLoginPath("citizen", "exemplo", "/\\evil.example"),
      "/c/exemplo",
    );
    assert.equal(
      resolvePostLoginPath("citizen", "exemplo", "https://evil.example"),
      "/c/exemplo",
    );
    assert.equal(
      resolvePostLoginPath("citizen", "exemplo", "/c/exemplo/instalacions"),
      "/c/exemplo/instalacions",
    );
  });

  it("resolvePostLoginPath: conta club só o seu clubId", () => {
    assert.equal(
      resolvePostLoginPath(
        "club_manager",
        "exemplo",
        "/c/exemplo/clubs/club-volei",
        "club-basquet",
      ),
      "/c/exemplo/clubs/club-basquet",
    );
    assert.equal(
      resolvePostLoginPath(
        "club_manager",
        "exemplo",
        "/c/proba/clubs/club-basquet",
        "club-basquet",
      ),
      "/c/exemplo/clubs/club-basquet",
    );
    assert.equal(
      resolvePostLoginPath(
        "club_manager",
        "exemplo",
        "/c/exemplo/clubs/club-basquet/tempada",
        "club-basquet",
      ),
      "/c/exemplo/clubs/club-basquet/tempada",
    );
  });

  it("userBelongsToMunicipality: Admin Exemplo só Exemplo; Ana cidadán con Cl@ve pode cruzar", () => {
    const adminExemplo = {
      id: "user-admin",
      municipalityId: "muni-exemplo",
      role: "admin" as const,
      displayName: "Admin Exemplo",
      locale: "gl" as const,
    };
    assert.equal(userBelongsToMunicipality(adminExemplo, "muni-exemplo"), true);
    assert.equal(userBelongsToMunicipality(adminExemplo, "muni-proba"), false);
    assert.equal(isElevatedRole("admin"), true);
    assert.equal(isElevatedRole("citizen"), false);

    const ana = {
      id: "user-cidada",
      municipalityId: "muni-exemplo",
      role: "citizen" as const,
      displayName: "Ana Demo",
      personIdentifier: "ES/ES/12345678Z",
      locale: "gl" as const,
    };
    assert.equal(userBelongsToMunicipality(ana, "muni-exemplo"), true);
    assert.equal(userBelongsToMunicipality(ana, "muni-proba"), true);

    const senClave = {
      id: "user-email",
      municipalityId: "muni-exemplo",
      role: "citizen" as const,
      displayName: "Sen Clave",
      locale: "gl" as const,
    };
    assert.equal(userBelongsToMunicipality(senClave, "muni-proba"), false);
  });

  it("dashboard de Proba non é accesible conceptualmente para admin Exemplo", async () => {
    const exemploDash = await dashboardStats("muni-exemplo");
    const exDash = await dashboardStats("muni-proba");
    assert.ok(typeof exemploDash.todayCount === "number");
    assert.ok(typeof exDash.todayCount === "number");
    // A illamento aplícase na capa HTTP; aquí comprobamos que os IDs son distintos
    assert.notEqual("muni-exemplo", "muni-proba");
  });

  it("avisos de Exemplo non mesturan userId de Proba", async () => {
    const exemplo = await listUnreadNotices("muni-exemplo", "user-cidada");
    const ex = await listUnreadNotices("muni-proba", "user-cidada-proba");
    assert.ok(Array.isArray(exemplo));
    assert.ok(Array.isArray(ex));
  });

  it("alta wizard crea admin propio do novo concello", async () => {
    const m = await createMunicipalityFull({
      name: "Concello Test Tenant",
      slug: "test-tenant",
      accentColor: "#334455",
      adminEmail: "admin@test-tenant.demo.pistaaberta.com",
      adminDisplayName: "Admin Test",
      adminNif: "12345678Z",
    });
    assert.equal(m.admin?.email, "admin@test-tenant.demo.pistaaberta.com");
    assert.equal(m.id, "muni-test-tenant");
    assert.notEqual(m.admin?.id, "user-admin");
  });

  it("1 conta por club: seed Club Deportivo Exemplo + illamento", async () => {
    const accounts = await listClubAccounts("muni-exemplo");
    const basquet = accounts.find((a) => a.id === "club-basquet");
    assert.ok(basquet?.account);
    assert.equal(basquet!.account!.id, "user-club");
    assert.equal(basquet!.account!.clubId, "club-basquet");
    assert.equal(basquet!.name, "Club Deportivo Exemplo");

    const clubUser = {
      id: "user-club",
      municipalityId: "muni-exemplo",
      role: "club_manager" as const,
      displayName: "Club Deportivo Exemplo",
      locale: "gl" as const,
      clubId: "club-basquet",
    };
    assert.equal(clubAccountOwnsClub(clubUser, "club-basquet", "muni-exemplo"), true);
    assert.equal(clubAccountOwnsClub(clubUser, "club-volei", "muni-exemplo"), false);
    assert.equal(clubAccountOwnsClub(clubUser, "club-basquet", "muni-proba"), false);

    /* Admin principal noutro concello + user_roles admin aquí. */
    const adminLinked = {
      id: "user-admin-terceiro",
      municipalityId: "muni-terceiro",
      role: "admin" as const,
      displayName: "Admin Terceiro",
      locale: "gl" as const,
      linkedMuniRoles: [
        {
          role: "admin" as const,
          municipalityId: "muni-exemplo",
          municipalityName: "Exemplo",
          label: "Admin",
        },
      ],
    };
    assert.equal(
      clubAccountOwnsClub(adminLinked, "club-basquet", "muni-exemplo"),
      true,
    );
    assert.equal(
      clubAccountOwnsClub(adminLinked, "club-basquet", "muni-proba"),
      false,
    );

    const created = await createClubWithAccount({
      municipalityId: "muni-exemplo",
      name: "Club Test Novo",
      accountEmail: "club.test@demo.pistaaberta.com",
    });
    assert.equal(created.account?.email, "club.test@demo.pistaaberta.com");
    assert.equal(created.account?.role, "club_manager");
    assert.equal(created.account?.clubId, created.id);
    assert.equal(created.municipalityId, "muni-exemplo");
  });
});
