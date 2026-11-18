import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { initDb, closeDb, getDb } from "../db/client.js";
import { migrateSchema } from "../db/migrate.js";
import { seedDb } from "../db/seed-db.js";
import * as t from "../db/schema.js";
import { optionalAuth } from "../middleware/auth.js";
import { createSession, setSessionActiveMuniRole } from "../identity/sessions.js";
import { certificateRoutes } from "../identity/certificate-routes.js";
import { adminMellorasRoutes } from "../routes/admin-melloras.js";
import { completeRoutes } from "../routes/complete.js";
import {
  publicPortalRoutes,
  registerMockIdpRoutes,
  toPublicMunicipalityInfo,
} from "../routes/public-portal-routes.js";
import {
  cancelBooking,
  createBooking,
  listSlots,
  onBookingCancelled,
} from "./db.js";
import { acceptInvitation, createInvitation } from "./invitations.js";
import { putMunicipalityBranding, createClubRequest } from "./admin-ops.js";
import { ensureSlotsAhead } from "./slots-ahead.js";
import {
  addDaysIso,
  DEFAULT_TIMEZONE,
  localDateIso,
  weekendSaturdayIso,
} from "./business-rules.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-rev60-lows-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-revision-60-lows";
process.env.CERT_LOGIN_ENABLED = "1";
process.env.CERT_GATEWAY_SECRET = "test-cert-gateway-secret-32chars!!";
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

describe("REVISION-60 N3..N11 baixos", () => {
  const mid = "muni-exemplo";
  const app = new Hono();
  app.use("*", optionalAuth);
  app.route("/", publicPortalRoutes);
  app.route("/", adminMellorasRoutes);
  app.route("/", completeRoutes);
  app.route("/", certificateRoutes());
  registerMockIdpRoutes(app);

  let adminCookie = "";
  let clubCookie = "";
  let citizenCookie = "";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await ensureSlotsAhead(new Date(), { days: 7 });

    const adminSid = await createSession({
      id: "user-admin",
      municipalityId: mid,
      role: "admin",
      displayName: "Admin Exemplo",
      email: "admin@exemplo.gal",
      locale: "gl",
    });
    await setSessionActiveMuniRole(adminSid, "admin", mid);
    adminCookie = `pa_sesion=${adminSid}`;

    const clubSid = await createSession({
      id: "user-club",
      municipalityId: mid,
      role: "club_manager",
      clubId: "club-basquet",
      displayName: "Club Deportivo Exemplo",
      email: "club.xestor@demo.pistaaberta.com",
      locale: "gl",
    });
    clubCookie = `pa_sesion=${clubSid}`;

    const citizenSid = await createSession({
      id: "user-cidada",
      municipalityId: mid,
      role: "citizen",
      displayName: "Ana",
      email: "ana.demo@demo.pistaaberta.com",
      personIdentifier: "ES/ES/12345678Z",
      locale: "gl",
    });
    citizenCookie = `pa_sesion=${citizenSid}`;
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("N3: /api/c/:slug/pavillon oculta email, cif e notas de propostas sen sesión club/admin no concello", async () => {
    await getDb()
      .update(t.clubs)
      .set({ email: "privado@cdexemplo.gal", cif: "G1500100H" })
      .where(eq(t.clubs.id, "club-basquet"));

    const sat = weekendSaturdayIso(new Date(), DEFAULT_TIMEZONE, 0);
    await createClubRequest({
      municipalityId: mid,
      clubId: "club-basquet",
      type: "match",
      payload: {
        facilityId: "fac-exemplo-pav",
        unitId: "unit-pav-full",
        date: sat,
        start: "20:00",
        end: "21:30",
        homeTeam: "Club Deportivo Exemplo",
        awayTeam: "Visitante",
      },
      note: "Nota interna confidencial do club",
      userId: "user-club",
      userName: "Club Deportivo Exemplo",
    });

    const pubRes = await app.request("/api/c/exemplo/pavillon");
    assert.equal(pubRes.status, 200);
    const pubJson = (await pubRes.json()) as {
      data: {
        clubs: Array<Record<string, unknown>>;
        matches: Array<{ id: string; notes?: string }>;
        swaps: unknown[];
      };
    };
    for (const cl of pubJson.data.clubs) {
      assert.equal("email" in cl, false);
      assert.equal("cif" in cl, false);
    }
    assert.equal(pubJson.data.swaps.length, 0);
    assert.equal(
      pubJson.data.matches.some((m) => m.id.startsWith("proposed-") || Boolean(m.notes)),
      false,
    );

    const otherAdminSid = await createSession({
      id: "user-admin-proba",
      municipalityId: "muni-proba",
      role: "admin",
      displayName: "Admin Proba",
      email: "admin@proba.gal",
      locale: "gl",
    });
    const crossRes = await app.request("/api/c/exemplo/pavillon", {
      headers: { cookie: `pa_sesion=${otherAdminSid}` },
    });
    const crossJson = (await crossRes.json()) as typeof pubJson;
    for (const cl of crossJson.data.clubs) {
      assert.equal("email" in cl, false);
      assert.equal("cif" in cl, false);
    }

    const adminRes = await app.request("/api/c/exemplo/pavillon", {
      headers: { cookie: adminCookie },
    });
    assert.equal(adminRes.status, 200);
    const adminJson = (await adminRes.json()) as typeof pubJson;
    const cb = adminJson.data.clubs.find((c) => c.id === "club-basquet");
    assert.equal(cb?.email, "privado@cdexemplo.gal");
    assert.equal(cb?.cif, "G1500100H");
    assert.equal(
      adminJson.data.matches.some(
        (m) => m.id.startsWith("proposed-") && m.notes === "Nota interna confidencial do club",
      ),
      true,
    );

    const clubRes = await app.request("/api/c/exemplo/pavillon", {
      headers: { cookie: clubCookie },
    });
    assert.equal(clubRes.status, 200);
    const clubJson = (await clubRes.json()) as typeof pubJson;
    assert.equal(
      clubJson.data.matches.some((m) => m.id.startsWith("proposed-")),
      true,
    );
  });

  it("N4: POST /reservas esixe rulesAccepted === true cando hai normas configuradas", async () => {
    const day = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 2);
    const slots = await listSlots({
      municipalityId: mid,
      unitId: "unit-padel-1",
      date: day,
    });
    const free = slots.find((s) => !s.occupied && !s.closed);
    assert.ok(free);

    const missingRes = await app.request("/api/c/exemplo/reservas", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: citizenCookie,
      },
      body: JSON.stringify({ slotId: free!.id }),
    });
    assert.equal(missingRes.status, 400);
    assert.deepEqual(await missingRes.json(), { error: "rules_not_accepted" });

    const okRes = await app.request("/api/c/exemplo/reservas", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: citizenCookie,
      },
      body: JSON.stringify({ slotId: free!.id, rulesAccepted: true }),
    });
    assert.equal(okRes.status, 201);
  });

  it("N5: POST /api/me/familia valida birthYear (1900..ano actual) e relation enum igual ca PATCH", async () => {
    const futureYear = new Date().getFullYear() + 1;
    const badYear = await app.request("/api/me/familia", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: citizenCookie,
      },
      body: JSON.stringify({
        displayName: "Menor Futuro",
        birthYear: futureYear,
        relation: "fillo",
      }),
    });
    assert.equal(badYear.status, 400);

    const badRel = await app.request("/api/me/familia", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: citizenCookie,
      },
      body: JSON.stringify({
        displayName: "Parentesco Libre",
        birthYear: 2015,
        relation: "veciño",
      }),
    });
    assert.equal(badRel.status, 400);

    const okFam = await app.request("/api/me/familia", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: citizenCookie,
      },
      body: JSON.stringify({
        displayName: "Xoel",
        birthYear: 2016,
        relation: "fillo",
      }),
    });
    assert.equal(okFam.status, 201);
  });

  it("N6: POST admin/instalacions aplica H1 en units[], e formato real HH:MM / YYYY-MM-DD en grupos fixos, mover e informe mensual", async () => {
    const badFac = await app.request("/api/c/exemplo/admin/instalacions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        name: "Instalación N6",
        type: "pista",
        address: "Rúa Nova 1",
        lat: 42.78,
        lng: -8.88,
        units: [{ name: "Pista X", slotMinutes: 0, capacity: 500 }],
      }),
    });
    assert.equal(badFac.status, 400);

    const badGroup = await app.request("/api/c/exemplo/admin/grupos-fixos", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        name: "Escola N6",
        facilityId: "fac-exemplo-padel",
        unitId: "unit-padel-1",
        weekday: 2,
        start: "25:99",
        end: "26:00",
        validFrom: "2026-02-30",
        validTo: "2026-03-30",
      }),
    });
    assert.equal(badGroup.status, 400);

    const badMove = await app.request(
      "/api/c/exemplo/admin/pavillon/matches/match-any/mover",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({
          facilityId: "fac-exemplo-pav",
          unitId: "unit-pav-full",
          date: "2026-13-40",
          start: "99:00",
          end: "10:00",
        }),
      },
    );
    assert.equal(badMove.status, 400);

    const badReport = await app.request(
      "/api/c/exemplo/admin/informe-mensual?ano=2026&mes=13",
      { headers: { cookie: adminCookie } },
    );
    assert.equal(badReport.status, 400);

    const okReport = await app.request(
      "/api/c/exemplo/admin/informe-mensual?ano=2026&mes=11",
      { headers: { cookie: adminCookie } },
    );
    assert.equal(okReport.status, 200);
  });

  it("N7: cancelBooking transaccional dispara hooks laterais unha soa vez se hai dobre cancelación", async () => {
    const day = addDaysIso(localDateIso(new Date(), DEFAULT_TIMEZONE), 3);
    const slots = await listSlots({
      municipalityId: mid,
      unitId: "unit-padel-2",
      date: day,
    });
    const free = slots.find((s) => !s.occupied && !s.closed);
    assert.ok(free);

    const b = await createBooking({
      municipalityId: mid,
      slotId: free!.id,
      userId: "user-brais",
      userDisplayName: "Luis",
    });

    let hookCallsForSlot = 0;
    onBookingCancelled(async (slotId) => {
      if (slotId === free!.id) hookCallsForSlot += 1;
    });

    const first = await cancelBooking(b.id, "user-brais");
    assert.equal(first.status, "cancelled");
    assert.equal(hookCallsForSlot, 1);

    await assert.rejects(
      () => cancelBooking(b.id, "user-brais"),
      /already_cancelled/,
    );
    assert.equal(hookCallsForSlot, 1);
  });

  it("N8: convite sen NIF (só correo) non pode aceptalo outra persoa con correo distinto", async () => {
    const { token } = await createInvitation({
      municipalityId: mid,
      role: "staff",
      email: "persoal.exclusivo@exemplo.gal",
      createdBy: "Admin Exemplo",
    });

    await assert.rejects(
      () =>
        acceptInvitation({
          token,
          user: {
            id: "user-cidada",
            municipalityId: mid,
            role: "citizen",
            displayName: "Ana",
            email: "ana.demo@demo.pistaaberta.com",
            personIdentifier: "ES/ES/12345678Z",
            locale: "gl",
          },
        }),
      /invite_wrong_person/,
    );

    await getDb().insert(t.users).values({
      id: "user-n8-staff",
      municipalityId: mid,
      role: "citizen",
      displayName: "Persoal N8",
      email: "persoal.exclusivo@exemplo.gal",
      personIdentifier: "ES/ES/88888888Y",
      locale: "gl",
      active: true,
    });

    const accepted = await acceptInvitation({
      token,
      user: {
        id: "user-n8-staff",
        municipalityId: mid,
        role: "citizen",
        displayName: "Persoal N8",
        email: "persoal.exclusivo@exemplo.gal",
        personIdentifier: "ES/ES/88888888Y",
        locale: "gl",
      },
    });
    assert.equal(accepted.id, "user-n8-staff");
  });

  it("N9: /api/c/:slug/info non devolve logoDataUrl nin opcións internas, e /api/c/:slug/logo serve o escudo con Cache-Control", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><circle cx="12" cy="12" r="10" fill="#0055AA"/></svg>`;
    await putMunicipalityBranding(mid, "Admin Exemplo", {
      logoDataUrl: svg,
      deputacionCanViewPersonalData: true,
    });

    const infoRes = await app.request("/api/c/exemplo/info");
    assert.equal(infoRes.status, 200);
    const infoJson = (await infoRes.json()) as {
      data: { settings: Record<string, unknown> };
    };
    assert.equal("logoDataUrl" in infoJson.data.settings, false);
    assert.equal("deputacionCanViewPersonalData" in infoJson.data.settings, false);
    assert.equal(infoJson.data.settings.sandbox, false);
    assert.equal("sandboxExpiresAt" in infoJson.data.settings, false);
    assert.equal("staffStrongAuth" in infoJson.data.settings, false);
    assert.equal(typeof infoJson.data.settings.logoUrl, "string");
    assert.match(String(infoJson.data.settings.logoUrl), /^\/api\/c\/exemplo\/logo\?v=/);

    const logoRes = await app.request("/api/c/exemplo/logo");
    assert.equal(logoRes.status, 200);
    assert.match(logoRes.headers.get("content-type") ?? "", /^image\/svg\+xml/);
    assert.match(logoRes.headers.get("cache-control") ?? "", /max-age=3600/);
    assert.ok(logoRes.headers.get("etag"));
    assert.equal(logoRes.headers.get("x-content-type-options"), "nosniff");
    const svgBody = await logoRes.text();
    assert.equal(svgBody.includes("<script"), false);
    assert.equal(svgBody.includes("<circle"), true);

    const logoV = await app.request("/api/c/exemplo/logo?v=test");
    assert.equal(logoV.status, 200);
    assert.match(
      logoV.headers.get("cache-control") ?? "",
      /max-age=31536000.*immutable|immutable.*max-age=31536000/,
    );
    assert.ok(logoV.headers.get("etag"));
  });

  it("P3: toPublicMunicipalityInfo inclúe settings.sandbox booleano en /api/municipalities e concellos sandbox", async () => {
    const listRes = await app.request("/api/municipalities");
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as {
      data: Array<{ slug: string; settings: Record<string, unknown> }>;
    };
    assert.ok(listJson.data.length > 0);
    for (const item of listJson.data) {
      assert.equal(typeof item.settings.sandbox, "boolean");
      assert.equal(item.settings.sandbox, false);
    }

    const pubSandbox = toPublicMunicipalityInfo({
      id: "muni-sbx-p3",
      slug: "sbx-p3",
      name: "Concello Sandbox P3",
      accentColor: "#1456C8",
      locales: ["gl", "es"],
      settings: {
        maxHoursPerWeek: 4,
        bookingAntelationDays: 7,
        sandbox: true,
        sandboxExpiresAt: "2026-12-01T00:00:00.000Z",
      },
    });
    assert.equal(pubSandbox.settings.sandbox, true);
    assert.equal("sandboxExpiresAt" in pubSandbox.settings, false);
  });

  it("N10: publicBaseUrl ignora X-Forwarded-Host e cookies cert levan Secure con APP_BASE_URL https", async () => {
    const prevBase = process.env.APP_BASE_URL;
    const prevApi = process.env.API_BASE_URL;
    const prevSecure = process.env.COOKIE_SECURE;
    delete process.env.APP_BASE_URL;
    delete process.env.API_BASE_URL;
    try {
      const dcatRes = await app.request(
        "http://lexitimo.concello.gal/api/c/exemplo/datos-abertos/instalacions.jsonld",
        {
          headers: { "x-forwarded-host": "atacante.evil.example" },
        },
      );
      assert.equal(dcatRes.status, 200);
      const text = await dcatRes.text();
      assert.equal(text.includes("atacante.evil.example"), false);
      assert.equal(text.includes("lexitimo.concello.gal"), true);

      process.env.APP_BASE_URL = "https://demo.pistaaberta.gal";
      delete process.env.COOKIE_SECURE;

      await getDb().insert(t.certLoginStates).values({
        id: "st-n10",
        municipalityId: mid,
        returnTo: "/c/exemplo",
        expiresAt: new Date(Date.now() + 60_000),
      });
      await getDb().insert(t.certLoginTickets).values({
        id: "tk-n10",
        userId: "user-cidada",
        stateId: "st-n10",
        returnTo: "/c/exemplo",
        expiresAt: new Date(Date.now() + 60_000),
      });

      const finishRes = await app.request("/auth/cert/finish?ticket=tk-n10", {
        headers: { cookie: "pa_cert_state=st-n10" },
      });
      assert.equal(finishRes.status, 302);
      const setCookies = finishRes.headers.getSetCookie();
      const authVia = setCookies.find((c) => c.startsWith("pa_auth_via="));
      assert.ok(authVia);
      assert.match(authVia!, /;\s*Secure\b/);
    } finally {
      if (prevBase === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = prevBase;
      if (prevApi === undefined) delete process.env.API_BASE_URL;
      else process.env.API_BASE_URL = prevApi;
      if (prevSecure === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = prevSecure;
    }
  });

  it("N11: mock-idp desactívase con Cl@ve real, peches rexeitan startsAt >= endsAt, e /facilities respecta portalPublished sen romper admin", async () => {
    const prevSso = process.env.SAML_IDP_SSO_URL;
    try {
      process.env.SAML_IDP_SSO_URL = "https://pasarela.clave.gob.es/Proxy2/ServiceProvider";
      const mockGet = await app.request("/auth/saml/mock-idp");
      assert.equal(mockGet.status, 404);
      const mockPost = await app.request("/auth/saml/mock-idp/sso", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "user=admin&RelayState=/",
      });
      assert.equal(mockPost.status, 404);
    } finally {
      if (prevSso === undefined) delete process.env.SAML_IDP_SSO_URL;
      else process.env.SAML_IDP_SSO_URL = prevSso;
    }

    const invertedClosure = await app.request("/api/c/exemplo/admin/peches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        facilityId: "fac-exemplo-padel",
        startsAt: "2026-12-10T18:00",
        endsAt: "2026-12-10T12:00",
        reason: "Invertido",
      }),
    });
    assert.equal(invertedClosure.status, 400);
    assert.deepEqual(await invertedClosure.json(), {
      error: "invalid_closure_datetime",
    });

    const exRow = (
      await getDb()
        .select()
        .from(t.municipalities)
        .where(eq(t.municipalities.id, "muni-proba"))
        .limit(1)
    )[0]!;
    const prevSettings = exRow.settings;
    await getDb()
      .update(t.municipalities)
      .set({ settings: { ...prevSettings, portalPublished: false } })
      .where(eq(t.municipalities.id, "muni-proba"));

    try {
      const pubFacRes = await app.request("/api/c/proba/facilities");
      assert.equal(pubFacRes.status, 200);
      const pubFacJson = (await pubFacRes.json()) as { data: unknown[] };
      assert.deepEqual(pubFacJson.data, []);

      const exAdminSid = await createSession({
        id: "user-admin-proba",
        municipalityId: "muni-proba",
        role: "admin",
        displayName: "Admin Proba",
        email: "admin@proba.gal",
        locale: "gl",
      });
      await setSessionActiveMuniRole(exAdminSid, "admin", "muni-proba");
      const adminFacRes = await app.request("/api/c/proba/facilities", {
        headers: { cookie: `pa_sesion=${exAdminSid}` },
      });
      assert.equal(adminFacRes.status, 200);
      const adminFacJson = (await adminFacRes.json()) as { data: unknown[] };
      assert.ok(adminFacJson.data.length >= 1);
    } finally {
      await getDb()
        .update(t.municipalities)
        .set({ settings: prevSettings })
        .where(eq(t.municipalities.id, "muni-proba"));
    }
  });
});
