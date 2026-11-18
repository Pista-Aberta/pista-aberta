/**
 * Illamento escritura: usuario de Proba non pode POST a Exemplo.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-writes-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-tenancy-writes";
delete process.env.DATABASE_URL;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { municipalityMiddleware } = await import("../tenancy.js");
const {
  requireSameMunicipality,
  requireMuniRoles,
} = await import("../middleware/auth.js");
const {
  listActivities,
  pavilionWeekend,
  proposeSwap,
  resolveConflict,
  runLottery,
  acceptSwapProposal,
} = await import("./db.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");

function buildProbeApp() {
  const app = new Hono();
  app.post(
    "/api/c/:slug/reservas",
    municipalityMiddleware,
    requireSameMunicipality(),
    async (c) => c.json({ ok: true }, 201),
  );
  app.post(
    "/api/c/:slug/checkin",
    municipalityMiddleware,
    requireMuniRoles("staff", "admin", "monitor"),
    async (c) => c.json({ ok: true }),
  );
  app.post(
    "/api/c/:slug/pavillon/swap",
    municipalityMiddleware,
    requireMuniRoles("club_manager", "admin"),
    async (c) => c.json({ ok: true }, 201),
  );
  app.post(
    "/api/c/:slug/pavillon/resolve",
    municipalityMiddleware,
    requireMuniRoles("admin"),
    async (c) => c.json({ ok: true }),
  );
  app.post(
    "/api/c/:slug/actividades/:id/inscribir",
    municipalityMiddleware,
    requireSameMunicipality(),
    async (c) => c.json({ ok: true }, 201),
  );
  app.post(
    "/api/c/:slug/actividades/:id/sortear",
    municipalityMiddleware,
    requireMuniRoles("admin"),
    async (c) => c.json({ ok: true }),
  );
  return app;
}

async function cookieFor(userKey: keyof typeof SAML_DEMO_USERS): Promise<string> {
  const u = SAML_DEMO_USERS[userKey]!;
  const { key: _k, givenName: _g, familyName: _f, ...rest } = u;
  const sid = await createSession(rest);
  return `pa_sesion=${sid}`;
}

describe("escritura cross-tenant (Proba → Exemplo)", () => {
  const app = buildProbeApp();

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("cidadán con personIdentifier SI pasa o middleware noutro concello (P1)", async () => {
    const cookie = await cookieFor("cidada-proba");
    const res = await app.request("/api/c/exemplo/reservas", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slotId: "x" }),
    });
    // requireSameMunicipality OK para cidadán con Cl@ve → handler 201 (probe)
    assert.equal(res.status, 201);
  });

  it("cidadán sen personIdentifier non reserva noutro concello", async () => {
    const sid = await createSession({
      id: "user-cidada-email-only",
      municipalityId: "muni-proba",
      municipalitySlug: "proba",
      role: "citizen",
      displayName: "Sen Clave",
      email: "sen.clave@demo.pistaaberta.com",
      locale: "gl",
    });
    const res = await app.request("/api/c/exemplo/reservas", {
      method: "POST",
      headers: {
        Cookie: `pa_sesion=${sid}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slotId: "x" }),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { reason?: string };
    assert.equal(body.reason, "wrong_municipality");
  });

  it("admin Proba non sortea en Exemplo", async () => {
    const cookie = await cookieFor("admin-proba");
    const res = await app.request("/api/c/exemplo/actividades/act-natacion/sortear", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { reason?: string };
    assert.equal(body.reason, "wrong_municipality");
  });

  it("staff Exemplo non checkin en Proba (e cidadán non checkin)", async () => {
    const staffExemplo = await cookieFor("staff");
    const res = await app.request("/api/c/proba/checkin", {
      method: "POST",
      headers: {
        Cookie: staffExemplo,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ qrPayload: "x" }),
    });
    assert.equal(res.status, 403);

    const cidEx = await cookieFor("cidada-proba");
    const res2 = await app.request("/api/c/proba/checkin", {
      method: "POST",
      headers: {
        Cookie: cidEx,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ qrPayload: "x" }),
    });
    assert.equal(res2.status, 403);
    const body2 = (await res2.json()) as { reason?: string };
    assert.equal(body2.reason, "role");
  });

  it("cidadán non propón swap; club alleo tampouco noutro concello", async () => {
    const cid = await cookieFor("cidada");
    const res = await app.request("/api/c/exemplo/pavillon/swap", {
      method: "POST",
      headers: {
        Cookie: cid,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fromMatchId: "a", toMatchId: "b" }),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { reason?: string };
    assert.equal(body.reason, "role");

    const club = await cookieFor("club");
    const res2 = await app.request("/api/c/proba/pavillon/swap", {
      method: "POST",
      headers: {
        Cookie: club,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fromMatchId: "a", toMatchId: "b" }),
    });
    assert.equal(res2.status, 403);
    const body2 = (await res2.json()) as { reason?: string };
    assert.equal(body2.reason, "wrong_municipality");
  });

  it("cidadán Proba SI pasa middleware de inscrición en Exemplo (P1; store illa por muni)", async () => {
    const cookie = await cookieFor("cidada-proba");
    const acts = await listActivities("muni-exemplo");
    const actId = acts[0]?.id ?? "act-any";
    const res = await app.request(`/api/c/exemplo/actividades/${actId}/inscribir`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(res.status, 201);
  });

  it("cidadán Exemplo SI pasa o middleware no seu concello", async () => {
    const cookie = await cookieFor("cidada");
    const res = await app.request("/api/c/exemplo/reservas", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slotId: "slot-probe" }),
    });
    // requireSameMunicipality OK → handler 201 (probe)
    assert.equal(res.status, 201);
  });

  it("store: sorteo / swap non cruzan municipalityId (IDOR)", async () => {
    await assert.rejects(
      () => runLottery("act-multi", "muni-proba"),
      /wrong_municipality/,
    );

    const pav = await pavilionWeekend("muni-exemplo");
    assert.ok(pav.matches.length >= 2, "seed pavillón Exemplo");
    const a = pav.matches[0]!.id;
    const b = pav.matches[1]!.id;

    await assert.rejects(
      () =>
        proposeSwap({
          municipalityId: "muni-proba",
          fromMatchId: a,
          toMatchId: b,
        }),
      /match_not_found/,
    );

    const swap = await proposeSwap({
      municipalityId: "muni-exemplo",
      fromMatchId: a,
      toMatchId: b,
    });
    await assert.rejects(
      () =>
        resolveConflict({
          municipalityId: "muni-proba",
          matchId: a,
          action: "accept_swap",
          swapId: swap.id,
        }),
      /not_found|swap_not_found/,
    );
    await assert.rejects(
      () => acceptSwapProposal(swap.id, "muni-proba"),
      /not_found/,
    );
  });
});
