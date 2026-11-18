/**
 * REVISION-32 C1 — aceptar convite con conta existente activa o papel
 * e abre o panel do concello novo (non a conserxaría «casa»).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r32-c1-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-r32-c1";
process.env.PA_DEMO = "1";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createMunicipalityFromWizard } = await import("./municipality-launch.js");
const {
  createSession,
  getSessionMeta,
  setSessionActiveMuniRole,
} = await import("../identity/sessions.js");
const { acceptInvitation, demoAcceptInvitation, getInvitationByToken } =
  await import("./invitations.js");
const { completeRoutes } = await import("../routes/complete.js");
const t = await import("../db/schema.js");

function buildApp() {
  const app = new Hono();
  app.route("/", completeRoutes);
  app.post("/api/convite/:token/aceptar", async (c) => {
    const sessionId = getCookie(c, "pa_sesion");
    if (!sessionId) return c.json({ error: "unauthorized" }, 401);
    const meta = await getSessionMeta(sessionId);
    if (!meta) return c.json({ error: "unauthorized" }, 401);
    try {
      const token = c.req.param("token")!;
      const inv = await getInvitationByToken(token);
      if (!inv) return c.json({ error: "invite_not_found" }, 404);
      const user = await acceptInvitation({ token, user: meta.user });
      const activated = await setSessionActiveMuniRole(
        sessionId,
        inv.role,
        inv.municipalityId,
      );
      return c.json({ user: activated ?? user });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, 400);
    }
  });
  app.post("/api/convite/:token/demo-aceptar", async (c) => {
    try {
      const token = c.req.param("token")!;
      const inv = await getInvitationByToken(token);
      if (!inv) return c.json({ error: "invite_not_found" }, 404);
      const user = await demoAcceptInvitation(token);
      const sessionId = await createSession(user);
      setCookie(c, "pa_sesion", sessionId, { path: "/" });
      const activated = await setSessionActiveMuniRole(
        sessionId,
        inv.role,
        inv.municipalityId,
      );
      return c.json({ user: activated ?? user });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "demo_only" ? 403 : 400);
    }
  });
  return app;
}

describe("REVISION-32 C1 convite conta existente", () => {
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

  it("Pedro (staff Exemplo) demo-aceptar admin noutro concello → panel 200", async () => {
    const xoan = (
      await getDb()
        .select()
        .from(t.users)
        .where(eq(t.users.personIdentifier, "ES/ES/87654321X"))
        .limit(1)
    )[0];
    assert.ok(xoan, "Pedro no seed");
    assert.equal(xoan.role, "staff");

    const slug = `terceiro-c1-${Date.now().toString(36)}`;
    const terceiro = await createMunicipalityFromWizard({
      name: "Concello de Terceiro",
      slug,
      ine: "32078",
      markedFacilities: ["Pistas (1)"],
      schedule: { pista: { open: "09:00", close: "22:00" } },
      norms: {},
      adminEmail: "admin.terceiro.c1@demo.gal",
      adminDisplayName: "Admin Terceiro",
      adminNif: "87654321X",
      sandbox: false,
      createdBy: "test",
    });
    assert.ok(terceiro.invite?.token);

    const res = await app.request(
      `/api/convite/${terceiro.invite!.token}/demo-aceptar`,
      { method: "POST" },
    );
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as {
      user: {
        role: string;
        activeMuniRole?: string | null;
        municipalitySlug?: string;
      };
    };
    assert.equal(body.user.role, "admin");
    assert.equal(body.user.activeMuniRole, "admin");
    assert.equal(body.user.municipalitySlug, slug);

    const cookie = res.headers.get("set-cookie") ?? "";
    const m = cookie.match(/pa_sesion=([^;]+)/);
    assert.ok(m?.[1], "cookie de sesión");

    const panel = await app.request(`/api/c/${slug}/admin/dashboard`, {
      headers: { Cookie: `pa_sesion=${m[1]}` },
    });
    assert.equal(panel.status, 200, "panel do concello novo accesible");
  });

  it("aceptar normal con sesión staff → activeMuniRole admin + panel 200", async () => {
    const xoan = (
      await getDb()
        .select()
        .from(t.users)
        .where(eq(t.users.personIdentifier, "ES/ES/87654321X"))
        .limit(1)
    )[0]!;

    const slug = `rois-c1-${Date.now().toString(36)}`;
    const rois = await createMunicipalityFromWizard({
      name: "Concello de Rois",
      slug,
      ine: "15074",
      markedFacilities: ["Pistas (1)"],
      schedule: { pista: { open: "09:00", close: "22:00" } },
      norms: {},
      adminEmail: "xoan.rois.c1@demo.gal",
      adminDisplayName: "Pedro Rois",
      adminNif: "87654321X",
      sandbox: false,
      createdBy: "test",
    });

    const sid = await createSession({
      id: xoan.id,
      municipalityId: xoan.municipalityId,
      role: "staff",
      displayName: xoan.displayName,
      personIdentifier: xoan.personIdentifier ?? undefined,
      locale: "gl",
    });

    const res = await app.request(`/api/convite/${rois.invite!.token}/aceptar`, {
      method: "POST",
      headers: { Cookie: `pa_sesion=${sid}` },
    });
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as {
      user: { role: string; activeMuniRole?: string | null };
    };
    assert.equal(body.user.role, "admin");
    assert.equal(body.user.activeMuniRole, "admin");

    const panel = await app.request(`/api/c/${slug}/admin/dashboard`, {
      headers: { Cookie: `pa_sesion=${sid}` },
    });
    assert.equal(panel.status, 200);
  });
});
