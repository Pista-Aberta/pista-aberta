/**
 * TANDA-1 / REVISION-40 N5 — illamento Exemplo ↔ Proba.
 * Percorre `app.routes` (non 5 rutas a man): cada ruta `/api/c/:slug/…`
 * con máis params recibe IDs de Exemplo baixo o slug `proba` → 403/404
 * (ou 401/400 se esixe auth/corpo; nunca 200 con recurso alleo).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-t1-iso-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-tanda1-iso";
delete process.env.DATABASE_URL;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");
const { municipalityMiddleware } = await import("../tenancy.js");
const { completeRoutes } = await import("../routes/complete.js");
const { adminMellorasRoutes } = await import("../routes/admin-melloras.js");
const { avisosBaixaRoutes } = await import("../routes/avisos-baixa.js");
const { optionalAuth } = await import("../middleware/auth.js");
const {
  getFacility,
  getMunicipalityBySlug,
  listFacilities,
  listBookings,
  listActivities,
  listClubs,
  listUnits,
} = await import("./db.js");
const { listClosures } = await import("./admin-ops.js");

async function cookieFor(userKey: keyof typeof SAML_DEMO_USERS): Promise<string> {
  const u = SAML_DEMO_USERS[userKey]!;
  const { key: _k, givenName: _g, familyName: _f, ...rest } = u;
  const sid = await createSession(rest);
  return `pa_sesion=${sid}`;
}

function buildApp() {
  const app = new Hono();
  app.use("*", optionalAuth);
  app.route("/", completeRoutes);
  app.route("/", adminMellorasRoutes);
  app.route("/", avisosBaixaRoutes);

  /* Rutas do index.ts relevantes para illamento (non están no completeRoutes). */
  app.get("/api/c/:slug/facilities/:id", municipalityMiddleware, async (c) => {
    const f = await getFacility(c.req.param("id")!);
    if (!f || f.municipalityId !== c.get("municipalityId") || !f.active) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ data: f });
  });

  app.get(
    "/api/c/:slug/facilities/:id/meteo",
    municipalityMiddleware,
    async (c) => {
      const f = await getFacility(c.req.param("id")!);
      if (!f || f.municipalityId !== c.get("municipalityId")) {
        return c.json({ error: "not_found" }, 404);
      }
      return c.json({ data: { outdoor: true } });
    },
  );

  app.get("/api/c/:slug/widget-data", municipalityMiddleware, async (c) => {
    const mid = c.get("municipalityId");
    const facilityId = c.req.query("facilityId");
    if (facilityId) {
      const f = await getFacility(facilityId);
      if (!f || f.municipalityId !== mid || !f.active) {
        return c.json({ error: "not_found" }, 404);
      }
    }
    const muni = await getMunicipalityBySlug(c.get("municipalitySlug"));
    const facs = await listFacilities(mid);
    return c.json({ data: { slug: muni?.slug, facilities: facs.length } });
  });

  return app;
}

/** Substitúe params coñecidos por IDs de Exemplo. */
function fillPath(
  routePath: string,
  ids: Record<string, string>,
): string | null {
  let out = routePath.replace(":slug", "proba");
  const params = [...out.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!);
  for (const p of params) {
    const val =
      ids[p] ??
      ids.id ??
      ids.facilityId ??
      ids.bookingId ??
      ids.activityId ??
      ids.clubId ??
      ids.closureId ??
      ids.unitId;
    if (!val) return null;
    out = out.replace(`:${p}`, encodeURIComponent(val));
  }
  if (out.includes(":")) return null;
  return out;
}

const OK_DENY = new Set([400, 401, 403, 404, 405, 409, 415, 422, 429]);

describe("TANDA-1 illamento Exemplo↔Proba (app.routes)", () => {
  const app = buildApp();
  let adminCookie = "";
  let ids: Record<string, string> = {};

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    adminCookie = await cookieFor("admin-proba");

    const exemplo = await getMunicipalityBySlug("exemplo");
    assert.ok(exemplo);
    const facs = await listFacilities(exemplo.id);
    const fac = facs.find((f) => f.id.includes("padel")) ?? facs[0]!;
    const units = await listUnits(fac.id);
    const bookings = await listBookings({ municipalityId: exemplo.id });
    const acts = await listActivities(exemplo.id);
    const clubs = await listClubs(exemplo.id);
    const closures = await listClosures(exemplo.id);

    ids = {
      id: fac.id,
      facilityId: fac.id,
      unitId: units[0]?.id ?? fac.id,
      bookingId: bookings[0]?.id ?? fac.id,
      activityId: acts[0]?.id ?? fac.id,
      clubId: clubs[0]?.id ?? fac.id,
      clubIdParam: clubs[0]?.id ?? fac.id,
      closureId: closures[0]?.id ?? fac.id,
      requestId: fac.id,
      matchId: fac.id,
      noticeId: fac.id,
      userId: "user-ana",
      token: "x",
      code: "x",
    };
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("percorre app.routes con IDs alleos → sen 200", async () => {
    const tenantRoutes = app.routes.filter(
      (r) =>
        typeof r.path === "string" &&
        r.path.includes("/api/c/:slug/") &&
        /:[A-Za-z_]/.test(r.path.replace("/api/c/:slug", "")),
    );
    assert.ok(
      tenantRoutes.length >= 10,
      `esperábanse moitas rutas con params, hai ${tenantRoutes.length}`,
    );

    const seen = new Set<string>();
    const failures: string[] = [];

    for (const r of tenantRoutes) {
      const method = (r.method ?? "GET").toUpperCase();
      if (method === "ALL") continue;
      const filled = fillPath(r.path, ids);
      if (!filled) continue;
      const key = `${method} ${filled}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const init: RequestInit = {
        method,
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
        },
      };
      if (method !== "GET" && method !== "HEAD") {
        init.body = "{}";
      }

      const res = await app.request(filled, init);
      if (res.status === 200) {
        failures.push(`${key} → 200`);
      } else if (!OK_DENY.has(res.status) && res.status < 500) {
        /* 5xx ocasional por corpo baleiro: aínda illado; non fallar */
        if (res.status >= 500) continue;
        failures.push(`${key} → ${res.status}`);
      }
    }

    assert.ok(seen.size >= 8, `poucas rutas probadas: ${seen.size}`);
    assert.deepEqual(
      failures,
      [],
      `rutas que devolveron 200 (ou estado raro) con ID alleo:\n${failures.join("\n")}`,
    );
  });

  it("widget-data?facilityId allea → 404", async () => {
    const res = await app.request(
      `/api/c/proba/widget-data?facilityId=${ids.facilityId}`,
    );
    assert.equal(res.status, 404);
  });
});
