/**
 * REVISION-26 G2 (anonimizador Deputación) + G3 (OCSP revogado).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r26-g2-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-revision-26-g2";
process.env.CERT_OCSP_CHECK = "1";
delete process.env.DATABASE_URL;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const { ensureDemoCa } = await import("../test-utils/ensure-demo-ca.js");
ensureDemoCa(ROOT);
process.env.CERT_OCSP_CA = path.join(ROOT, "deploy/demo-ca/demo-ca.pem");
process.env.CERT_OCSP_INDEX = path.join(ROOT, "deploy/demo-ca/index.txt");

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { completeRoutes } = await import("../routes/complete.js");
const { adminMellorasRoutes } = await import("../routes/admin-melloras.js");
const { SAML_DEMO_USERS } = await import("../identity/saml-users.js");
const { assertCertOcspGood } = await import("../identity/cert-ocsp.js");
const { CertParseError } = await import("../identity/certificate.js");
const { anonymizeDeputacionPayload } = await import("./deputacion-anonymize.js");

async function cookieFor(userKey: keyof typeof SAML_DEMO_USERS): Promise<string> {
  const u = SAML_DEMO_USERS[userKey]!;
  const { key: _k, givenName: _g, familyName: _f, ...rest } = u;
  const sid = await createSession(rest);
  return `pa_sesion=${sid}`;
}

function buildApp() {
  const app = new Hono();
  app.route("/", completeRoutes);
  app.route("/", adminMellorasRoutes);
  return app;
}

/** Nomes / correos / DNI da semente que non poden aparecer. */
const SEED_PII = [
  "Ana Demo",
  "ana.demo@",
  "Luis Demo",
  "luis.demo@",
  "Antía",
  "12345678Z",
  "23456789D",
  "ES/ES/12345678Z",
  "ES/ES/23456789D",
  "admin.exemplo@",
  "conserxe.demo@",
];

describe("REVISION-26 G2 deputacion anonymize", () => {
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

  it("anonymizeDeputacionPayload deixa iniciais", () => {
    const out = anonymizeDeputacionPayload({
      userDisplayName: "Ana Demo",
      email: "ana@x.gal",
      personIdentifier: "ES/ES/12345678Z",
      phone: "600111222",
      count: 3,
    }) as Record<string, unknown>;
    assert.equal(out.userDisplayName, "AD");
    assert.equal(out.email, "");
    assert.equal(out.personIdentifier, "");
    assert.equal(out.phone, "");
    assert.equal(out.count, 3);
  });

  it("GET /api/c/exemplo/* como Deputación sen PII da semente", async () => {
    /* REVISION-34 F1: cambiar unha reserva como veciña ANTES dos GET Deputación. */
    const { listBookings, listSlots, modifyBooking } = await import("./db.js");
    const { audit } = await import("./extra.js");
    const cidadaId = SAML_DEMO_USERS.cidada!.id;
    const bookings = await listBookings({
      municipalityId: "muni-exemplo",
      userId: cidadaId,
    });
    const editable = bookings.find((b) => b.status === "confirmed");
    if (editable) {
      const slots = await listSlots({
        municipalityId: "muni-exemplo",
        facilityId: editable.facilityId,
        date: editable.date,
      });
      const free = slots.find((s) => !s.occupied && !s.closed && s.id !== editable.slotId);
      if (free) {
        try {
          const { booking, previousSlotId } = await modifyBooking({
            bookingId: editable.id,
            newSlotId: free.id,
            userId: cidadaId,
          });
          await audit(
            "muni-exemplo",
            cidadaId,
            "booking.modify",
            `${booking.id}:${previousSlotId}->${booking.slotId}`,
          );
        } catch {
          /* Prazo / ocupado: aínda así deixamos unha fila de auditoría co nome
             (regresión) e comprobamos que o anonimizador a limpa no export. */
          await audit(
            "muni-exemplo",
            "Ana Demo",
            "booking.modify",
            "Ana Demo:fallback-test",
          );
        }
      } else {
        await audit(
          "muni-exemplo",
          "Ana Demo",
          "booking.modify",
          "Ana Demo:no-free-slot",
        );
      }
    } else {
      await audit(
        "muni-exemplo",
        "Ana Demo",
        "booking.modify",
        "Ana Demo:no-booking",
      );
    }

    const cookie = await cookieFor("deputacion");
    const paths = [
      "/api/c/exemplo/admin/export",
      "/api/c/exemplo/admin/export?format=csv",
      "/api/c/exemplo/admin/dashboard",
      "/api/c/exemplo/admin/hoxe",
      "/api/c/exemplo/conserxeria",
      "/api/c/exemplo/admin/reservas-dia",
      "/api/c/exemplo/actividades",
      "/api/c/exemplo/facilities",
      "/api/c/exemplo/admin/persoal",
      "/api/c/exemplo/me",
    ];
    /* Descubre máis GETs de actividades. */
    const actList = await app.request("/api/c/exemplo/actividades", {
      headers: { Cookie: cookie },
    });
    if (actList.status === 200) {
      const body = (await actList.json()) as { data?: Array<{ id: string }> };
      for (const a of body.data ?? []) {
        paths.push(`/api/c/exemplo/actividades/${a.id}`);
      }
    }

    for (const p of paths) {
      const res = await app.request(p, { headers: { Cookie: cookie } });
      if (res.status === 404 || res.status === 403 || res.status === 401) continue;
      const text = await res.text();
      for (const needle of SEED_PII) {
        assert.equal(
          text.includes(needle),
          false,
          `PII «${needle}» en ${p} (status ${res.status})`,
        );
      }
    }

    /* Aserción explícita: actor da auditoría non leva o nome da veciña. */
    const scrubbed = anonymizeDeputacionPayload({
      audit: [{ actor: "Ana Demo", detail: "Ana Demo:booking.modify", action: "booking.modify" }],
    }) as { audit: Array<{ actor: string; detail: string }> };
    assert.equal(scrubbed.audit[0]!.actor, "AD");
    assert.equal(scrubbed.audit[0]!.detail.startsWith("AD"), true);
  });
});

describe("REVISION-26 G3 OCSP revogado", () => {
  it("revogado-demo.pem → cert_revogado", () => {
    const pemPath = path.join(ROOT, "deploy/demo-ca/revogado-demo.pem");
    assert.ok(fs.existsSync(pemPath), "falta revogado-demo.pem");
    const pem = fs.readFileSync(pemPath, "utf8");
    assert.throws(
      () => assertCertOcspGood(pem),
      (e: unknown) => e instanceof CertParseError && e.code === "cert_revogado",
    );
  });

  it("cidada-demo.pem non está revogado no índice", () => {
    const pemPath = path.join(ROOT, "deploy/demo-ca/cidada-demo.pem");
    assert.ok(fs.existsSync(pemPath));
    const pem = fs.readFileSync(pemPath, "utf8");
    assert.doesNotThrow(() => assertCertOcspGood(pem));
  });
});
