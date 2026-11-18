/**
 * REVISION-30 Z1 — convite Exemplo→Terceiro conserva conta; retirar non a apaga.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { and, eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r30-z1-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-r30-z1";
process.env.PA_DEMO = "1";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createInvitation, acceptInvitation, demoAcceptInvitation } =
  await import("./invitations.js");
const { createMunicipalityFromWizard, retirarAdminAccess } = await import(
  "./municipality-launch.js"
);
const { createSession, getSession } = await import("../identity/sessions.js");
const { listLinkedMuniRolesForUser } = await import("./user-roles.js");
const t = await import("../db/schema.js");

describe("REVISION-30 Z1 contas", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("veciña de Exemplo acepta admin de Terceiro → conserva correo, nome e ten dous papeis", async () => {
    const ana = (
      await getDb()
        .select()
        .from(t.users)
        .where(eq(t.users.personIdentifier, "ES/ES/12345678Z"))
        .limit(1)
    )[0];
    assert.ok(ana);
    const emailBefore = ana.email;
    const nameBefore = ana.displayName;
    const muniBefore = ana.municipalityId;

    const terceiro = await createMunicipalityFromWizard({
      name: "Concello de Terceiro",
      slug: `terceiro-z1-${Date.now().toString(36)}`,
      ine: "32078",
      markedFacilities: ["Pistas (2)"],
      schedule: { pista: { open: "09:00", close: "22:00" } },
      norms: { rule1: true, rule2: true, rule3: true },
      adminEmail: "admin@terceiro.gal",
      adminDisplayName: "Admin Terceiro",
      adminNif: "12345678Z",
      sandbox: false,
      createdBy: "test",
    });
    assert.ok(terceiro.invite?.token);

    const accepted = await acceptInvitation({
      token: terceiro.invite!.token,
      user: {
        id: ana.id,
        municipalityId: ana.municipalityId,
        role: ana.role as "citizen",
        displayName: ana.displayName,
        email: ana.email ?? undefined,
        personIdentifier: ana.personIdentifier ?? undefined,
        locale: "gl",
      },
    });

    const after = (
      await getDb().select().from(t.users).where(eq(t.users.id, ana.id)).limit(1)
    )[0]!;
    assert.equal(after.email, emailBefore, "correo conservado");
    assert.equal(after.displayName, nameBefore, "nome conservado");
    assert.equal(after.municipalityId, muniBefore, "concello casa conservado");
    assert.notEqual(after.role, "admin", "rol global non sobrescrito a admin");

    const roles = await getDb()
      .select()
      .from(t.userRoles)
      .where(
        and(eq(t.userRoles.userId, ana.id), eq(t.userRoles.active, true)),
      );
    assert.ok(
      roles.some((r) => r.role === "admin" && r.municipalityId === terceiro.id),
      "ten papel admin en Terceiro",
    );

    const linked = await listLinkedMuniRolesForUser(ana.id, muniBefore);
    assert.ok(
      linked.some((r) => r.role === "admin" && r.municipalityId === terceiro.id),
      "linkedMuniRoles inclúe Terceiro",
    );
    assert.equal(accepted.id, ana.id);
  });

  it("demoAccept con conta nova usa displayName do convite", async () => {
    const slug = `rois-z1-${Date.now().toString(36)}`;
    const m = await createMunicipalityFromWizard({
      name: "Concello de Rois",
      slug,
      ine: "15074",
      markedFacilities: ["Pistas (1)"],
      schedule: { pista: { open: "09:00", close: "22:00" } },
      norms: {},
      adminEmail: "ana.perez.nova@rois.gal",
      adminDisplayName: "Ana Pérez",
      adminNif: "78123456T",
      sandbox: false,
      createdBy: "test",
    });
    const user = await demoAcceptInvitation(m.invite!.token);
    assert.equal(user.displayName, "Ana Pérez");
  });

  it("retirarAdminAccess desactiva só o papel; a conta segue viva (Exemplo)", async () => {
    const xoan = (
      await getDb()
        .select()
        .from(t.users)
        .where(eq(t.users.personIdentifier, "ES/ES/87654321X"))
        .limit(1)
    )[0];
    assert.ok(xoan, "Pedro no seed");
    const exemploId = xoan.municipalityId;

    const slug = `terceiro-ret-${Date.now().toString(36)}`;
    const terceiro = await createMunicipalityFromWizard({
      name: "Concello de Terceiro",
      slug,
      ine: "32078",
      markedFacilities: ["Pistas (1)"],
      schedule: { pista: { open: "09:00", close: "22:00" } },
      norms: {},
      adminEmail: "admin.terceiro@demo.gal",
      adminDisplayName: "Admin Terceiro",
      adminNif: "87654321X",
      sandbox: false,
      createdBy: "test",
    });
    await acceptInvitation({
      token: terceiro.invite!.token,
      user: {
        id: xoan.id,
        municipalityId: xoan.municipalityId,
        role: xoan.role as "staff",
        displayName: xoan.displayName,
        email: xoan.email ?? undefined,
        personIdentifier: xoan.personIdentifier ?? undefined,
        locale: "gl",
      },
    });

    await retirarAdminAccess(terceiro.id, "deputacion", "cambio de persoal");

    const after = (
      await getDb().select().from(t.users).where(eq(t.users.id, xoan.id)).limit(1)
    )[0]!;
    assert.equal(after.active, true, "conta activa");
    assert.equal(after.municipalityId, exemploId);

    const adminTerceiro = await getDb()
      .select()
      .from(t.userRoles)
      .where(
        and(
          eq(t.userRoles.userId, xoan.id),
          eq(t.userRoles.municipalityId, terceiro.id),
          eq(t.userRoles.role, "admin"),
        ),
      );
    assert.ok(
      adminTerceiro.every((r) => !r.active),
      "admin Terceiro desactivado",
    );

    const sid = await createSession({
      id: xoan.id,
      municipalityId: xoan.municipalityId,
      role: xoan.role as "staff",
      displayName: xoan.displayName,
      email: xoan.email ?? undefined,
      personIdentifier: xoan.personIdentifier ?? undefined,
      locale: "gl",
    });
    const session = await getSession(sid);
    assert.ok(session, "pode seguir con sesión");
  });
});
