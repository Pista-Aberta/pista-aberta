/**
 * REVISION-28 X3 / REVISION-27 §3.2 — user_roles, Dar acceso por NIF, convites.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r28-x3-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-r28-x3";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { inviteStaffUser } = await import("./staff-users.js");
const { createInvitation, acceptInvitation, getInvitationByToken } =
  await import("./invitations.js");
const { createSession, setSessionActiveMuniRole } = await import("../identity/sessions.js");
const { completeRoutes } = await import("../routes/complete.js");
const t = await import("../db/schema.js");

function buildApp() {
  const app = new Hono();
  app.get("/api/convite/:token", async (c) => {
    const data = await getInvitationByToken(c.req.param("token")!);
    if (!data) return c.json({ error: "invite_not_found" }, 404);
    return c.json({ data });
  });
  app.post("/api/convite/:token/aceptar", async (c) => {
    const cookie = c.req.header("Cookie") ?? "";
    const m = /pa_sesion=([^;]+)/.exec(cookie);
    if (!m) return c.json({ error: "unauthorized" }, 401);
    const { getSessionMeta } = await import("../identity/sessions.js");
    const meta = await getSessionMeta(m[1]!);
    if (!meta) return c.json({ error: "unauthorized" }, 401);
    try {
      const user = await acceptInvitation({
        token: c.req.param("token")!,
        user: meta.user,
      });
      return c.json({ user });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, 400);
    }
  });
  app.route("/", completeRoutes);
  return app;
}

describe("REVISION-28 X3 + §3.2 convites", () => {
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

  it("REVISION-50 S1: Dar acceso a veciña existente → convite (non ligar soa)", async () => {
    const row = await inviteStaffUser({
      municipalityId: "muni-exemplo",
      displayName: "Luis Demo",
      email: "luis.staff@concello.gal",
      nif: "23456789D",
    });
    assert.equal(row.invitePending, true);
    assert.ok(row.inviteToken);
    const brais = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/23456789D"))
      .limit(1);
    assert.equal(brais[0]?.role, "citizen");
    const roles = await getDb()
      .select()
      .from(t.userRoles)
      .where(eq(t.userRoles.userId, brais[0]!.id));
    assert.ok(!roles.some((r) => r.role === "staff" && r.active));
  });

  it("Dar acceso non sobrescribe displayName (Y4 Ana) — convite", async () => {
    const ana = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/12345678Z"))
      .limit(1);
    assert.ok(ana[0]);
    const before = ana[0]!.displayName;
    const row = await inviteStaffUser({
      municipalityId: "muni-exemplo",
      displayName: "Ana Conserxe",
      email: "ana.conserxe@concello.gal",
      nif: "12345678Z",
    });
    assert.equal(row.invitePending, true);
    assert.equal(row.displayName, before);
    const after = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.id, ana[0]!.id))
      .limit(1);
    assert.equal(after[0]?.displayName, before);
  });

  it("NIF demo Luis é válido (X4)", async () => {
    const { toPersonIdentifier } = await import("../lib/nif.js");
    assert.equal(toPersonIdentifier("23456789D"), "ES/ES/23456789D");
  });

  it("acepta convite admin co NIF correcto", async () => {
    const { token } = await createInvitation({
      municipalityId: "muni-proba",
      role: "admin",
      email: "nova.admin@proba.gal",
      nif: "44556677L",
      createdBy: "test",
    });
    const cidada = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/44556677L"))
      .limit(1);
    assert.ok(cidada[0]);
    const sid = await createSession({
      id: cidada[0]!.id,
      municipalityId: cidada[0]!.municipalityId,
      role: cidada[0]!.role as "citizen",
      displayName: cidada[0]!.displayName,
      personIdentifier: "ES/ES/44556677L",
      locale: "gl",
    });
    const res = await app.request(`/api/convite/${token}/aceptar`, {
      method: "POST",
      headers: { Cookie: `pa_sesion=${sid}` },
    });
    assert.equal(res.status, 200);
    const again = await getInvitationByToken(token);
    assert.equal(again?.used, true);
  });

  it("convite con NIF distinto → invite_wrong_person", async () => {
    const { token } = await createInvitation({
      municipalityId: "muni-exemplo",
      role: "staff",
      nif: "12345678Z",
      createdBy: "test",
    });
    const brais = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/23456789D"))
      .limit(1);
    const sid = await createSession({
      id: brais[0]!.id,
      municipalityId: brais[0]!.municipalityId,
      role: "citizen",
      displayName: brais[0]!.displayName,
      personIdentifier: "ES/ES/23456789D",
      locale: "gl",
    });
    const res = await app.request(`/api/convite/${token}/aceptar`, {
      method: "POST",
      headers: { Cookie: `pa_sesion=${sid}` },
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "invite_wrong_person");
  });

  it("conmutador rol municipal (staff) tras aceptar convite", async () => {
    const { acceptInvitation } = await import("./invitations.js");
    const brais = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/23456789D"))
      .limit(1);
    const inv = await inviteStaffUser({
      municipalityId: "muni-exemplo",
      displayName: "Luis Demo",
      email: "luis.staff2@concello.gal",
      nif: "23456789D",
    });
    assert.ok(inv.inviteToken);
    await acceptInvitation({
      token: inv.inviteToken!,
      user: {
        id: brais[0]!.id,
        municipalityId: brais[0]!.municipalityId,
        role: "citizen",
        displayName: brais[0]!.displayName,
        personIdentifier: "ES/ES/23456789D",
        locale: "gl",
      },
    });
    const sid = await createSession(
      {
        id: brais[0]!.id,
        municipalityId: brais[0]!.municipalityId,
        role: "citizen",
        displayName: brais[0]!.displayName,
        personIdentifier: "ES/ES/23456789D",
        locale: "gl",
      },
      { authMethod: "saml" },
    );
    const asStaff = await setSessionActiveMuniRole(sid, "staff");
    assert.equal(asStaff?.role, "staff");
    assert.ok(asStaff?.linkedMuniRoles?.some((r) => r.role === "staff"));
  });
});
