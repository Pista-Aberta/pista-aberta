/**
 * REVISION-27 §4 — alta concello, convite, checklist, publicar, En preparación.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r27-alta-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-r27-alta";
process.env.PA_DEMO = "0";
delete process.env.DATABASE_URL;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { completeRoutes } = await import("../routes/complete.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");
const { getInvitationByToken, acceptInvitation } = await import("./invitations.js");
const { publishPortal } = await import("./municipality-launch.js");
const t = await import("../db/schema.js");

async function cookieFor(userKey: keyof typeof SAML_DEMO_USERS): Promise<string> {
  const u = SAML_DEMO_USERS[userKey]!;
  const { key: _k, givenName: _g, familyName: _f, ...rest } = u;
  const sid = await createSession(rest);
  return `pa_sesion=${sid}`;
}

function buildApp() {
  const app = new Hono();
  app.route("/", completeRoutes);
  return app;
}

describe("REVISION-27 alta concello §4", () => {
  const app = buildApp();
  let terceiroSlug: string;
  let inviteToken: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("asistente sen sesión → 401", async () => {
    const res = await app.request("/api/municipalities/wizard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", slug: "x-no-auth" }),
    });
    assert.equal(res.status, 401);
  });

  it("1–2: alta Terceiro con 2 instalacións e horario 16–22 + convite", async () => {
    terceiroSlug = `terceiro-r27-${Date.now()}`;
    const cookie = await cookieFor("deputacion");
    const res = await app.request("/api/municipalities/wizard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        name: "Concello de Terceiro",
        slug: terceiroSlug,
        ine: "32078",
        markedFacilities: ["Pistas (3)", "Campos de fútbol"],
        schedule: { pista: { open: "16:00", close: "22:00" }, campo: { open: "16:00", close: "22:00" } },
        norms: { rule1: true, rule2: true, rule3: true },
        adminEmail: "ana@terceiro.gal",
        adminDisplayName: "Ana Pérez",
        adminNif: "44556677L",
      }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      data: { invite?: { token: string }; facilitiesCreated: number; slug: string };
    };
    assert.ok(body.data.invite?.token);
    assert.ok(body.data.facilitiesCreated >= 2);
    inviteToken = body.data.invite!.token;

    /* REVISION-40 N2 — alta garda settings.ineCode */
    const muniRow = await getDb()
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.id, `muni-${terceiroSlug}`))
      .limit(1);
    assert.equal(
      (muniRow[0]?.settings as { ineCode?: string } | undefined)?.ineCode,
      "32078",
    );

    const facs = await getDb()
      .select()
      .from(t.facilities)
      .where(eq(t.facilities.municipalityId, `muni-${terceiroSlug}`));
    assert.equal(facs.length, 2);
    assert.ok(facs[0]!.address.includes("Terceiro") || facs[0]!.address.includes("Concello"));
    assert.notEqual(facs[0]!.address, "Enderezo demo");

    const oh = await getDb()
      .select()
      .from(t.openingHours)
      .where(eq(t.openingHours.municipalityId, `muni-${terceiroSlug}`));
    assert.ok(oh.some((h) => h.open === "16:00" && h.close === "22:00"));
  });

  it("3–4: aceptar convite e checklist marca horarios (Z1)", async () => {
    const { listLinkedMuniRolesForUser } = await import("./user-roles.js");
    const cidada = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/44556677L"))
      .limit(1);
    assert.ok(cidada[0]);
    const homeMuni = cidada[0]!.municipalityId;
    const user = await acceptInvitation({
      token: inviteToken,
      user: {
        id: cidada[0]!.id,
        municipalityId: cidada[0]!.municipalityId,
        role: "citizen",
        displayName: cidada[0]!.displayName,
        personIdentifier: "ES/ES/44556677L",
        locale: "gl",
      },
    });
    /* REVISION-31 A2 / Z1: conta existente noutro concello → papel en user_roles. */
    const roles = await getDb()
      .select()
      .from(t.userRoles)
      .where(eq(t.userRoles.userId, user.id));
    assert.ok(
      roles.some(
        (r) =>
          r.role === "admin" &&
          r.municipalityId === `muni-${terceiroSlug}` &&
          r.active,
      ),
      "papel admin en user_roles do concello novo",
    );
    const linked = await listLinkedMuniRolesForUser(user.id, homeMuni);
    assert.ok(
      linked.some((r) => r.role === "admin" && r.municipalityId === `muni-${terceiroSlug}`),
      "linkedMuniRoles inclúe o concello do convite",
    );

    const mid = `muni-${terceiroSlug}`;
    const oh = await getDb()
      .select()
      .from(t.openingHours)
      .where(eq(t.openingHours.municipalityId, mid));
    assert.ok(oh.length > 0, "o asistente crea horarios");

    /* Z2: o checklist de horarios só conta instalacións activas. */
    const facs = await getDb()
      .select()
      .from(t.facilities)
      .where(eq(t.facilities.municipalityId, mid));
    await getDb()
      .update(t.facilities)
      .set({ active: true })
      .where(eq(t.facilities.id, facs[0]!.id));
    await getDb()
      .update(t.units)
      .set({ active: true })
      .where(eq(t.units.facilityId, facs[0]!.id));

    const sid = await createSession({
      id: user.id,
      municipalityId: mid,
      role: "admin",
      displayName: user.displayName,
      personIdentifier: "ES/ES/44556677L",
      locale: "gl",
      municipalitySlug: terceiroSlug,
      activeMuniRole: "admin",
    });
    const panel = await app.request(`/api/c/${terceiroSlug}/admin/dashboard`, {
      headers: { Cookie: `pa_sesion=${sid}` },
    });
    assert.equal(panel.status, 200, "panel admin accesible co papel ligado (Z1)");
    const panelBody = (await panel.json()) as {
      data: { launch: { items: Array<{ id: string; done: boolean }> } };
    };
    const sched = panelBody.data.launch.items.find((i) => i.id === "schedules");
    assert.equal(sched?.done, true);
  });

  it("concello sen publicar → portalPublished false", async () => {
    const { getMunicipalityBySlug } = await import("./db.js");
    const m = await getMunicipalityBySlug(terceiroSlug);
    assert.ok(m);
    assert.equal(m!.settings.portalPublished, false);
  });

  it("6–7: publicar tras activar instalación e datos legais", async () => {
    const mid = `muni-${terceiroSlug}`;
    const facs = await getDb().select().from(t.facilities).where(eq(t.facilities.municipalityId, mid));
    await getDb()
      .update(t.facilities)
      .set({ active: true })
      .where(eq(t.facilities.id, facs[0]!.id));
    await getDb()
      .update(t.units)
      .set({ active: true })
      .where(eq(t.units.facilityId, facs[0]!.id));

    const muniRow = await getDb()
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.id, mid))
      .limit(1);
    await getDb()
      .update(t.municipalities)
      .set({
        settings: {
          ...muniRow[0]!.settings,
          legal: {
            titular: "Concello de Terceiro",
            email: "concello@terceiro.gal",
            address: "Casa do Concello, Terceiro",
          },
        },
      })
      .where(eq(t.municipalities.id, mid));

    const pub = await publishPortal(mid, "test");
    assert.equal(pub.ok, true);

    const after = await getDb()
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.id, mid))
      .limit(1);
    assert.equal(after[0]!.settings.portalPublished, true);
  });

  it("convite usado → invite_used", async () => {
    await assert.rejects(
      () =>
        acceptInvitation({
          token: inviteToken,
          user: {
            id: "user-cidada",
            municipalityId: "muni-exemplo",
            role: "citizen",
            displayName: "Test",
            personIdentifier: "ES/ES/44556677L",
            locale: "gl",
          },
        }),
      /invite_used/,
    );
  });
});
