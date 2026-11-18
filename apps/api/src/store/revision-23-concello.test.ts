/**
 * REVISION-23 R1/R2/R4 — compose concello, garda PA_DEMO, tenant responsables.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../../..");

describe("REVISION-23 R1 docker-compose.concello", () => {
  it("config non contén PA_DEMO: \"1\" nin mailpit", () => {
    const compose = path.join(ROOT, "docker-compose.concello.yml");
    assert.ok(fs.existsSync(compose), "falta docker-compose.concello.yml");
    const raw = fs.readFileSync(compose, "utf8");
    assert.doesNotMatch(raw, /PA_DEMO:\s*"1"/);
    assert.doesNotMatch(raw, /^\s*mailpit:/m);
    assert.doesNotMatch(raw, /SMTP_HOST:\s*mailpit/);
    assert.match(raw, /\$\{PA_DEMO:-0\}/);
    assert.match(raw, /VITE_PA_DEMO:\s*\$\{VITE_PA_DEMO:-0\}/);
    assert.match(raw, /caddy:/i);
    assert.match(raw, /PA_SINGLE_MUNI/);
    assert.match(raw, /VITE_PA_SINGLE_MUNI/);

    /* Se hai Docker, valida tamén o render do compose. */
    try {
      execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    } catch {
      return;
    }
    const env = {
      ...process.env,
      DOMAIN: "reservas.test.local",
      POSTGRES_PASSWORD: "test-pg-pass-revision-23",
      /* REVISION-26 M1: compose esixe CERT_GATEWAY_SECRET (obrigatorio no Caddy). */
      CERT_GATEWAY_SECRET: "test-cert-gateway-secret-revision-26-fake",
      SESSION_SECRET: "test-session-secret-revision-23-long",
      APP_BASE_URL: "https://reservas.test.local",
      PA_DEMO: "0",
      VITE_PA_DEMO: "0",
      NODE_ENV: "production",
    };
    const out = execFileSync(
      "docker",
      ["compose", "-f", compose, "config"],
      { encoding: "utf8", env, cwd: ROOT },
    );
    assert.doesNotMatch(out, /PA_DEMO:\s*"1"/);
    assert.doesNotMatch(out, /^\s*mailpit:/m);
  });

  it("NODE_ENV=production + PA_DEMO=1 → assertProductionSafe falla", async () => {
    const prev = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.PA_DEMO = "1";
    process.env.SESSION_SECRET = "production-session-secret-long-enough-32";
    process.env.CERT_LOGIN_ENABLED = "0";
    process.env.SAML_ALLOW_DEMO_CERTS = "1";
    try {
      const { assertProductionSafe } = await import("../env.js");
      assert.throws(() => assertProductionSafe(), /PA_DEMO=1/);
    } finally {
      process.env = prev;
    }
  });
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r23-tenant-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-23-r4";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { listClubResponsables, addClubResponsable } = await import(
  "./club-members.js"
);
const { getDb } = await import("../db/client.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

describe("REVISION-23 R4 listClubResponsables tenant", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("admin Proba non ve responsables dun club de Exemplo", async () => {
    const clubId = "club-basquet";
    const exemplo = await listClubResponsables(clubId, "muni-exemplo");
    assert.ok(Array.isArray(exemplo));

    await assert.rejects(
      () => listClubResponsables(clubId, "muni-proba"),
      /not_found/,
    );
  });

  it("filtra municipalityId nos membros", async () => {
    const clubId = "club-basquet";
    const users = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.municipalityId, "muni-exemplo"))
      .limit(1);
    assert.ok(users[0]);
    await addClubResponsable({
      municipalityId: "muni-exemplo",
      clubId,
      userId: users[0]!.id,
      role: "coach",
      actor: "test",
    });
    const list = await listClubResponsables(clubId, "muni-exemplo");
    assert.ok(list.every((m) => m.municipalityId === "muni-exemplo"));
  });
});
