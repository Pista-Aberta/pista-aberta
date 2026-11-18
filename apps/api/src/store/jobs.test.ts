/**
 * Limpeza de sandbox e jobs (REVISION-2 §6–§7; REVISION-57 J5).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq, sql } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-jobs-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  deleteExpiredSandboxes,
  runHourlyJobs,
  SANDBOX_CLEANUP_TABLE_NAMES,
} = await import("./jobs.js");
const { createMunicipalityFromWizard } = await import("./municipality-launch.js");
const t = await import("../db/schema.js");

describe("jobs sandbox cleanup", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("borra concello sandbox caducado e o seu contido", async () => {
    const id = "muni-sandbox-old";
    const slug = "sandbox-old";
    await getDb().insert(t.municipalities).values({
      id,
      slug,
      name: "Sandbox Old",
      accentColor: "#333333",
      locales: ["gl"],
      settings: {
        maxHoursPerWeek: 4,
        bookingAntelationDays: 7,
        sandbox: true,
        sandboxExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    await getDb().insert(t.facilities).values({
      id: "fac-sb-old",
      municipalityId: id,
      name: "Pista SB",
      type: "pista",
      address: "x",
      lat: "0",
      lng: "0",
      accessibility: "",
      services: [],
      rules: "",
      active: true,
    });
    await getDb().insert(t.users).values({
      id: "user-sb-old",
      municipalityId: id,
      role: "citizen",
      displayName: "SB",
      email: "sb@example.com",
      locale: "gl",
      active: true,
    });

    const n = await deleteExpiredSandboxes(new Date());
    assert.ok(n >= 1);
    const rows = await getDb()
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.id, id));
    assert.equal(rows.length, 0);
    const fac = await getDb()
      .select()
      .from(t.facilities)
      .where(eq(t.facilities.id, "fac-sb-old"));
    assert.equal(fac.length, 0);
  });

  it("J5: asistente demo + un día → job sen excepción FK (invitations)", async () => {
    const slug = `j5-demo-${Date.now().toString(36)}`;
    const created = await createMunicipalityFromWizard({
      name: "Concello de J5 Demo",
      slug,
      ine: "15045",
      accentColor: "#002B4A",
      markedFacilities: ["Pista municipal"],
      schedule: { pista: { open: "09:00", close: "22:00" } },
      norms: { rule1: true, rule2: true, rule3: true },
      adminEmail: "admin-j5@example.gal",
      adminDisplayName: "Admin J5",
      adminNif: "12345678Z",
      sandbox: true,
      createdBy: "test:j5",
    });
    const mid = created.id;
    const invites = await getDb()
      .select()
      .from(t.invitations)
      .where(eq(t.invitations.municipalityId, mid));
    assert.ok(invites.length >= 1, "o asistente crea convite");

    const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);
    let summary;
    await assert.doesNotReject(async () => {
      summary = await runHourlyJobs(tomorrow);
    });
    assert.ok(summary);
    assert.ok(
      (summary as { sandboxesDeleted: number }).sandboxesDeleted >= 1,
      "debe borrar o concello do asistente",
    );
    const rows = await getDb()
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.id, mid));
    assert.equal(rows.length, 0);
    const leftInvites = await getDb()
      .select()
      .from(t.invitations)
      .where(eq(t.invitations.municipalityId, mid));
    assert.equal(leftInvites.length, 0);
  });

  it("M6: todas as táboas con FK a municipalities están cubertas e bórranse (incl. notification_outbox e notification_dedupes)", async () => {
    const db = getDb();
    const fkRes = await db.execute(
      sql.raw(`
        SELECT DISTINCT cls.relname AS table_name
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
        WHERE con.contype = 'f'
          AND nsp.nspname = current_schema()
          AND con.confrelid = 'municipalities'::regclass
        ORDER BY cls.relname
      `),
    );
    const fkRows: Array<Record<string, unknown>> = Array.isArray(fkRes)
      ? (fkRes as Array<Record<string, unknown>>)
      : ((fkRes as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []);
    const fkTables = fkRows.map((r) => String(r.table_name ?? ""));
    assert.ok(fkTables.includes("notification_outbox"));
    assert.ok(fkTables.includes("notification_dedupes"));

    const covered = new Set(SANDBOX_CLEANUP_TABLE_NAMES);
    const missing = fkTables.filter((tbl) => !covered.has(tbl));
    assert.deepEqual(
      missing,
      [],
      `Táboas con FK a municipalities sen borrar en deleteExpiredSandboxes: ${missing.join(", ")}`,
    );

    const mid = "muni-m6-sandbox";
    await db.insert(t.municipalities).values({
      id: mid,
      slug: "m6-sandbox",
      name: "Concello M6",
      accentColor: "#0055AA",
      locales: ["gl", "es"],
      settings: {
        maxHoursPerWeek: 4,
        bookingAntelationDays: 7,
        sandbox: true,
        sandboxExpiresAt: new Date(Date.now() - 10_000).toISOString(),
      },
    });
    await db.insert(t.users).values({
      id: "user-m6",
      municipalityId: mid,
      role: "citizen",
      displayName: "Persoa M6",
      email: "m6@example.gal",
      locale: "gl",
      active: true,
    });
    await db.insert(t.notificationOutbox).values({
      id: "outbox-m6-1",
      dedupeKey: "m6:outbox:1",
      municipalityId: mid,
      payload: { operationKey: "m6:op", notice: { id: "n-m6" } },
    });
    await db.insert(t.notificationDedupes).values({
      key: "m6:dedupe:1",
      municipalityId: mid,
      userId: "user-m6",
    });

    const deleted = await deleteExpiredSandboxes(new Date());
    assert.ok(deleted >= 1);

    const leftMuni = await db
      .select()
      .from(t.municipalities)
      .where(eq(t.municipalities.id, mid));
    assert.equal(leftMuni.length, 0);

    const leftOutbox = await db
      .select()
      .from(t.notificationOutbox)
      .where(eq(t.notificationOutbox.municipalityId, mid));
    assert.equal(leftOutbox.length, 0);

    const leftDedupes = await db
      .select()
      .from(t.notificationDedupes)
      .where(eq(t.notificationDedupes.municipalityId, mid));
    assert.equal(leftDedupes.length, 0);
  });
});
