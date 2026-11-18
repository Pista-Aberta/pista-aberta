import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { closeDb, getDb, initDb } from "../db/client.js";
import { migrateSchema } from "../db/migrate.js";
import * as t from "../db/schema.js";
import { createSession } from "../identity/sessions.js";
import { optionalAuth } from "../middleware/auth.js";
import { completeRoutes } from "../routes/complete.js";
import {
  DEPUTACION_DEMO_ORG_ID,
  DEPUTACION_PLATFORM_MUNI_ID,
  ensureDemoDeputacionEntity,
} from "./deputacion-org.js";
import { resetDemoData } from "./demo-reset.js";
import {
  ALL_DEMO_TABLE_NAMES,
  getDemoRestoreLastError,
  getDemoSnapshotStatus,
  hasDemoSnapshot,
  SNAPSHOT_TABLES,
} from "./demo-snapshot.js";
import { runHourlyJobs } from "./jobs.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-snap-test-"));
const pgliteDir = path.join(tmpRoot, "pglite");
const snapshotFile = path.join(tmpRoot, "vol", "demo-snapshot");

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function buildApp(): Hono {
  const app = new Hono();
  app.use("*", optionalAuth);
  app.route("/", completeRoutes);
  return app;
}

async function clearAllTables(): Promise<void> {
  const list = ALL_DEMO_TABLE_NAMES.map((name) => `"${name}"`).join(", ");
  await getDb().execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

async function seedCustomDemoState(): Promise<void> {
  await clearAllTables();
  await ensureDemoDeputacionEntity();
  const db = getDb();

  await db.insert(t.users).values({
    id: "user-superadmin-test",
    municipalityId: DEPUTACION_PLATFORM_MUNI_ID,
    organizationId: DEPUTACION_DEMO_ORG_ID,
    role: "superadmin",
    displayName: "Superadmin Proba",
    email: "superadmin@proba.proba.org",
    personIdentifier: "ES/ES/33445566R",
    locale: "gl",
    active: true,
  });

  await db.insert(t.municipalities).values({
    id: "muni-vilaproba",
    slug: "vilaproba",
    name: "Concello de Vilaproba",
    accentColor: "#1F5A73",
    locales: ["gl", "es"],
    settings: {
      maxHoursPerWeek: 4,
      bookingAntelationDays: 7,
      portalPublished: true,
    },
  });

  await db.insert(t.users).values({
    id: "user-admin-vilaproba",
    municipalityId: "muni-vilaproba",
    role: "admin",
    displayName: "Admin Vilaproba",
    email: "admin@vilaproba.proba.org",
    personIdentifier: "ES/ES/11223344B",
    locale: "gl",
    active: true,
  });

  await db.insert(t.facilities).values({
    id: "fac-vilaproba-pav",
    municipalityId: "muni-vilaproba",
    name: "Pavillón Municipal de Vilaproba",
    type: "pavillon",
    address: "Rúa do Deporte 1",
    lat: "42.7000",
    lng: "-8.8000",
    accessibility: "Acceso sen chanzo",
    services: ["vestiarios", "iluminacion"],
    rules: "Calzado limpo obrigatorio.",
    active: true,
    outdoor: false,
  });

  await db.insert(t.units).values({
    id: "unit-vilaproba-pista",
    facilityId: "fac-vilaproba-pav",
    municipalityId: "muni-vilaproba",
    name: "Pista central",
    incompatibleWith: [],
    bookingKind: "ambas",
    slotMinutes: 60,
    capacity: 10,
    active: true,
  });

  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    await db.insert(t.openingHours).values({
      id: `oh-vilaproba-${weekday}`,
      municipalityId: "muni-vilaproba",
      facilityId: "fac-vilaproba-pav",
      unitId: "unit-vilaproba-pista",
      weekday,
      open: "09:00",
      close: "12:00",
    });
  }

  await db.insert(t.clubs).values({
    id: "club-vilaproba-fs",
    municipalityId: "muni-vilaproba",
    name: "AD Vilaproba FS",
    shortName: "Vilaproba FS",
    sport: "futbol_sala",
  });
}

async function sessionCookieFor(userId: string): Promise<string> {
  const rows = await getDb()
    .select()
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  const u = rows[0]!;
  const sid = await createSession({
    id: u.id,
    municipalityId: u.municipalityId,
    role: u.role as "superadmin" | "admin",
    displayName: u.displayName,
    email: u.email ?? undefined,
    personIdentifier: u.personIdentifier ?? undefined,
    locale: "gl",
  });
  return `pa_sesion=${sid}`;
}

describe("Demo snapshot: gardar estado, restauración manual e 04:00", () => {
  const prevDemo = process.env.PA_DEMO;
  const prevSnap = process.env.DEMO_SNAPSHOT_PATH;
  const prevPglite = process.env.PGLITE_DATA_DIR;
  const prevDbUrl = process.env.DATABASE_URL;

  before(async () => {
    process.env.PGLITE_DATA_DIR = pgliteDir;
    process.env.PA_DEMO = "1";
    process.env.DEMO_SNAPSHOT_PATH = snapshotFile;
    process.env.NODE_ENV = "test";
    delete process.env.DATABASE_URL;
    await initDb();
    await migrateSchema();
  });

  after(async () => {
    await closeDb();
    if (prevDemo === undefined) delete process.env.PA_DEMO;
    else process.env.PA_DEMO = prevDemo;
    if (prevSnap === undefined) delete process.env.DEMO_SNAPSHOT_PATH;
    else process.env.DEMO_SNAPSHOT_PATH = prevSnap;
    if (prevPglite === undefined) delete process.env.PGLITE_DATA_DIR;
    else process.env.PGLITE_DATA_DIR = prevPglite;
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDbUrl;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("Dockerfile da API instala postgresql16-client na imaxe runner", () => {
    const dockerfile = fs.readFileSync(
      path.join(REPO_ROOT, "apps/api/Dockerfile"),
      "utf8",
    );
    const runnerStage = dockerfile.slice(
      dockerfile.indexOf("FROM node:22-alpine AS runner"),
    );
    assert.match(runnerStage, /apk add --no-cache[^\n]*postgresql16-client/);
  });

  it("gardar foto (superadmin), mutar datos e reset manual restaura o estado gardado sen helpers de semente", async () => {
    await seedCustomDemoState();
    const app = buildApp();

    const adminCookie = await sessionCookieFor("user-admin-vilaproba");
    const forbidden = await app.request("/api/demo/snapshot", {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(forbidden.status, 403);

    const superCookie = await sessionCookieFor("user-superadmin-test");
    const beforeSnap = await app.request("/api/demo/snapshot", {
      headers: { Cookie: superCookie },
    });
    assert.equal(beforeSnap.status, 200);
    const beforeBody = (await beforeSnap.json()) as {
      data: { configured: boolean; exists: boolean; at: string | null };
    };
    assert.equal(beforeBody.data.configured, true);
    assert.equal(beforeBody.data.exists, false);
    assert.equal(beforeBody.data.at, null);

    const saved = await app.request("/api/demo/snapshot", {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(saved.status, 200);
    const savedBody = (await saved.json()) as {
      data: { ok: boolean; mode: string; at: string };
    };
    assert.equal(savedBody.data.ok, true);
    assert.ok(savedBody.data.at);
    assert.equal(hasDemoSnapshot(), true);
    assert.equal(getDemoSnapshotStatus().at, savedBody.data.at);

    // Non quedaron ficheiros temporais da escrita atómica
    const volFiles = fs.readdirSync(path.dirname(snapshotFile));
    assert.equal(
      volFiles.some((f) => f.includes(".tmp.")),
      false,
    );

    // Mutar datos: renomear concello, borrar club e crear outro concello temporal
    const db = getDb();
    await db
      .update(t.municipalities)
      .set({ name: "Concello Alterado" })
      .where(eq(t.municipalities.id, "muni-vilaproba"));
    await db.delete(t.clubs).where(eq(t.clubs.id, "club-vilaproba-fs"));
    await db.insert(t.municipalities).values({
      id: "muni-intruso",
      slug: "intruso",
      name: "Concello Intruso",
      accentColor: "#000000",
      locales: ["gl", "es"],
      settings: { maxHoursPerWeek: 2, bookingAntelationDays: 7 },
    });

    const resetRes = await app.request("/api/demo/reset", {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(resetRes.status, 200);
    const resetBody = (await resetRes.json()) as {
      data: { restoredFromSnapshot: boolean };
    };
    assert.equal(resetBody.data.restoredFromSnapshot, true);

    const munisAfter = await db.select().from(t.municipalities);
    const slugsAfter = munisAfter.map((m) => m.slug).sort();
    assert.deepEqual(slugsAfter, ["_deputacion", "vilaproba"]);
    const vilaproba = munisAfter.find((m) => m.slug === "vilaproba")!;
    assert.equal(vilaproba.name, "Concello de Vilaproba");

    const clubsAfter = await db.select().from(t.clubs);
    assert.equal(clubsAfter.length, 1);
    assert.equal(clubsAfter[0]?.name, "AD Vilaproba FS");

    // ensureSlotsAhead xerou franxas para a unidade de Vilaproba (só 09-12, sen extensión tarde da semente)
    const slotsAfter = await db
      .select()
      .from(t.timeSlots)
      .where(eq(t.timeSlots.unitId, "unit-vilaproba-pista"));
    assert.ok(slotsAfter.length > 0);
    assert.equal(
      slotsAfter.some((s) => s.start >= "18:00"),
      false,
    );

    // Non se executaron os helpers de reservas/waitlist da semente
    const bookingsAfter = await db.select().from(t.bookings);
    assert.equal(bookingsAfter.length, 0);
    const waitlistAfter = await db.select().from(t.waitlistEntries);
    assert.equal(waitlistAfter.length, 0);
  });

  it("o job nocturno das 04:00 restaura a foto gardada en vez da semente", async () => {
    const db = getDb();
    await db
      .update(t.municipalities)
      .set({ name: "Modificado Antes Das Catro" })
      .where(eq(t.municipalities.id, "muni-vilaproba"));
    await db.delete(t.clubs).where(eq(t.clubs.id, "club-vilaproba-fs"));

    // 2026-11-18T03:15:00Z = 04:15 CET en Europe/Madrid
    const summary = await runHourlyJobs(new Date("2026-11-18T03:15:00.000Z"));
    assert.equal(summary.demoReset, true);
    assert.equal(summary.demoBookingsEnsured, 0);

    const muni = await db
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.id, "muni-vilaproba"))
      .limit(1);
    assert.equal(muni[0]?.name, "Concello de Vilaproba");

    const clubs = await db.select().from(t.clubs);
    assert.equal(clubs.length, 1);
    assert.equal(clubs[0]?.shortName, "Vilaproba FS");

    const bookings = await db.select().from(t.bookings);
    assert.equal(bookings.length, 0);
  });

  it("sen foto en DEMO_SNAPSHOT_PATH, resetDemoData conserva o comportamento habitual", async () => {
    fs.rmSync(snapshotFile, { force: true });
    fs.rmSync(`${snapshotFile}.meta.json`, { force: true });
    assert.equal(hasDemoSnapshot(), false);

    const res = await resetDemoData("test-no-snap");
    assert.equal(res.restoredFromSnapshot, false);
    const munis = await getDb().select().from(t.municipalities);
    assert.ok(munis.length >= 2);
  });

  it("F1: unha foto inválida non borra os datos (TRUNCATE+restore atómico)", async () => {
    await seedCustomDemoState();
    const db = getDb();
    const munisBefore = await db.select().from(t.municipalities);
    const clubsBefore = await db.select().from(t.clubs);
    assert.ok(munisBefore.some((m) => m.slug === "vilaproba"));
    assert.equal(clubsBefore.length, 1);

    fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
    /* JSON válido en estrutura pero cunha fila que viola NOT NULL → falla no INSERT. */
    fs.writeFileSync(
      snapshotFile,
      JSON.stringify({
        version: 1,
        format: "pglite-json",
        savedAt: new Date().toISOString(),
        actor: "test-bad-snap",
        tables: {
          municipalities: [
            {
              id: null,
              slug: "roto",
              name: "Roto",
              accentColor: "#000",
              locales: ["gl"],
              settings: {},
            },
          ],
        },
      }),
      "utf8",
    );
    assert.equal(hasDemoSnapshot(), true);

    await assert.rejects(
      () => resetDemoData("test-bad-snap"),
      /./,
    );

    const munisAfter = await db.select().from(t.municipalities);
    const clubsAfter = await db.select().from(t.clubs);
    assert.deepEqual(
      munisAfter.map((m) => m.slug).sort(),
      munisBefore.map((m) => m.slug).sort(),
    );
    assert.equal(clubsAfter.length, clubsBefore.length);
    assert.equal(
      munisAfter.find((m) => m.slug === "vilaproba")?.name,
      "Concello de Vilaproba",
    );

    const failAudits = await db
      .select()
      .from(t.auditEvents)
      .where(eq(t.auditEvents.action, "demo.reset.failed"));
    assert.ok(failAudits.length >= 1);

    const lastErr = await getDemoRestoreLastError();
    assert.ok(lastErr);
    assert.ok(lastErr!.message.length > 0);
  });

  it("F4: SNAPSHOT_TABLES coincide coas táboas de migrate.ts", () => {
    const migrateSrc = fs.readFileSync(
      path.join(REPO_ROOT, "apps/api/src/db/migrate.ts"),
      "utf8",
    );
    const migrateTables = [
      ...migrateSrc.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g),
    ].map((m) => m[1]!);
    const uniqueMigrate = [...new Set(migrateTables)].sort();
    const snapshotNames = [...SNAPSHOT_TABLES.map((e) => e.name)].sort();
    assert.deepEqual(
      snapshotNames,
      uniqueMigrate,
      `SNAPSHOT_TABLES desfasado fronte a migrate.ts.\n` +
        `só en snapshot: ${snapshotNames.filter((n) => !uniqueMigrate.includes(n)).join(", ") || "—"}\n` +
        `só en migrate: ${uniqueMigrate.filter((n) => !snapshotNames.includes(n)).join(", ") || "—"}`,
    );
    assert.equal(ALL_DEMO_TABLE_NAMES.length, uniqueMigrate.length);
  });

  it("panel de superadmin expón o botón con confirmación e data da última foto en gl e es", () => {
    const cardSrc = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/components/DemoSnapshotCard.tsx"),
      "utf8",
    );
    const depSrc = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/pages/DeputacionPage.tsx"),
      "utf8",
    );
    const gl = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "apps/web/src/i18n/gl.json"), "utf8"),
    ) as Record<string, string>;
    const es = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "apps/web/src/i18n/es.json"), "utf8"),
    ) as Record<string, string>;

    assert.equal(gl["admin.demoSnapshot"], "Gardar estado da demo");
    assert.equal(es["admin.demoSnapshot"], "Guardar estado de la demo");
    assert.ok(gl["admin.demoSnapshotLocked"]);
    assert.ok(es["admin.demoSnapshotLocked"]);
    assert.ok(gl["admin.demoSnapshotRestoreFailed"]);
    assert.ok(es["admin.demoSnapshotRestoreFailed"]);
    assert.match(cardSrc, /role="dialog"/);
    assert.match(cardSrc, /demo-snapshot-last/);
    assert.match(cardSrc, /demo-snapshot-locked/);
    assert.match(depSrc, /<DemoSnapshotCard/);
  });
});
