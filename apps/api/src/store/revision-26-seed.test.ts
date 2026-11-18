/**
 * REVISION-26 §0 — seedDb con «hoxe» falso (luns…domingo) + resetDemoData×2.
 * Reproduce o choque historia 28d vs bloque F2 do martes ao domingo.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sql } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r26-seed-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-revision-26-seed";
delete process.env.DATABASE_URL;
delete process.env.SMTP_HOST;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { buildSeed } = await import("./seed.js");
const { resetDemoData } = await import("./demo-reset.js");
const t = await import("../db/schema.js");

await initDb();
await migrateSchema();

/** Noon Madrid-ish UTC for each ISO weekday label (2026-11). */
const WEEKDAYS: { label: string; iso: string }[] = [
  { label: "luns", iso: "2026-11-02T11:00:00.000Z" }, // Mon
  { label: "martes", iso: "2026-11-03T11:00:00.000Z" },
  { label: "mercores", iso: "2026-11-04T11:00:00.000Z" },
  { label: "xoves", iso: "2026-11-05T11:00:00.000Z" },
  { label: "venres", iso: "2026-11-06T11:00:00.000Z" },
  { label: "sabado", iso: "2026-11-07T11:00:00.000Z" },
  { label: "domingo", iso: "2026-11-08T11:00:00.000Z" },
];

function assertUniqueSlots(slots: { unitId: string; date: string; start: string }[], label: string) {
  const keys = new Set<string>();
  for (const s of slots) {
    const k = `${s.unitId}|${s.date}|${s.start}`;
    assert.equal(keys.has(k), false, `duplicado ${k} (${label})`);
    keys.add(k);
  }
}

async function wipeAll() {
  const TABLES = [
    "notice_reads",
    "notices",
    "waitlist_entries",
    "incidents",
    "fixed_groups",
    "family_members",
    "activity_applications",
    "activities",
    "bookings",
    "time_slots",
    "opening_hours",
    "closures",
    "matches",
    "teams",
    "club_members",
    "club_requests",
    "clubs",
    "season_slots",
    "slot_swaps",
    "units",
    "facilities",
    "otp_challenges",
    "otp_rate_limits",
    "cert_login_tickets",
    "cert_login_states",
    "sessions",
    "audit_events",
    "users",
    "municipalities",
    "meta",
  ] as const;
  const list = TABLES.map((x) => `"${x}"`).join(", ");
  await getDb().execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

describe("REVISION-26 §0 seed weekday + reset×2", () => {
  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("buildSeed sen duplicados (unit,date,start) para os 7 días", () => {
    for (const d of WEEKDAYS) {
      const data = buildSeed(new Date(d.iso));
      assertUniqueSlots(data.slots, d.label);
      assert.ok(data.slots.some((s) => s.unitId === "unit-proba-campo"), d.label);
    }
  });

  it("seedDb con hoxe falso para luns…domingo non rebenta o unique", async () => {
    for (const d of WEEKDAYS) {
      await wipeAll();
      await seedDb(new Date(d.iso));
      const rows = await getDb().select().from(t.timeSlots);
      assertUniqueSlots(
        rows.map((r) => ({ unitId: r.unitId, date: r.date, start: r.start })),
        `db-${d.label}`,
      );
      assert.ok(rows.length > 100, `slots ${d.label}`);
    }
  });

  it("resetDemoData dúas veces seguidas OK", async () => {
    await wipeAll();
    await seedDb(new Date(WEEKDAYS[1]!.iso)); // martes
    const a = await resetDemoData("test-r26-1");
    assert.equal(a.ok, true);
    const b = await resetDemoData("test-r26-2");
    assert.equal(b.ok, true);
    const munis = await getDb().select().from(t.municipalities);
    assert.ok(munis.some((m) => m.slug === "exemplo"));
    const slots = await getDb().select().from(t.timeSlots);
    assertUniqueSlots(
      slots.map((r) => ({ unitId: r.unitId, date: r.date, start: r.start })),
      "reset×2",
    );
  });
});
