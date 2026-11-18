/**
 * staffStrongAuth: OTP de admin → 403 (REVISION-2 §9).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-strong-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
delete process.env.AUTH_ELEVATED_SAML_ONLY;
delete process.env.PA_DEMO;

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { EmailOtpIdentityProvider, StrongAuthRequiredError } =
  await import("./email-otp.js");
const t = await import("../db/schema.js");

describe("staffStrongAuth", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    await getDb()
      .update(t.municipalities)
      .set({
        settings: {
          maxHoursPerWeek: 4,
          bookingAntelationDays: 7,
          maxActiveBookings: 3,
          anonymizeAfterDays: 90,
          timezone: "Europe/Madrid",
          staffStrongAuth: true,
          theme: { brand: "#5A4636", accent: "#8B6914" },
        },
      })
      .where(eq(t.municipalities.id, "muni-exemplo"));
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("OTP de admin con staffStrongAuth → strong_auth_required", async () => {
    const otp = new EmailOtpIdentityProvider();
    await assert.rejects(
      () =>
        otp.login({
          method: "email_otp",
          identifier: "admin.exemplo@demo.pistaaberta.com",
          municipalityId: "muni-exemplo",
        }),
      (e: unknown) =>
        e instanceof StrongAuthRequiredError &&
        e.code === "strong_auth_required",
    );
  });

  it("OTP de cidadán segue permitido", async () => {
    const otp = new EmailOtpIdentityProvider();
    const r = await otp.login({
      method: "email_otp",
      identifier: "ana.demo@demo.pistaaberta.com",
      municipalityId: "muni-exemplo",
    });
    assert.ok(r.challengeId);
  });
});
