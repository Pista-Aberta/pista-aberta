/**
 * REVISION-22 A9: código OTP en pantalla só con PA_DEMO=1;
 * con PA_DEMO=0 non vai na resposta nin nos logs.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-otp-demo-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
delete process.env.SMTP_HOST;
delete process.env.AUTH_ELEVATED_SAML_ONLY;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");

describe("REVISION-22 A9 email OTP demoCode", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("PA_DEMO=1 → demoCode de 6 cifras na resposta", async () => {
    process.env.PA_DEMO = "1";
    const { EmailOtpIdentityProvider } = await import("./email-otp.js");
    const otp = new EmailOtpIdentityProvider();
    const logs: string[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const r = await otp.login({
        method: "email_otp",
        identifier: "ana.demo@demo.pistaaberta.com",
        municipalityId: "muni-exemplo",
      });
      assert.ok(r.challengeId);
      assert.ok(r.demoCode);
      assert.match(r.demoCode!, /^\d{6}$/);
      /* O valor do código non debe aparecer nos logs (só a mensaxe xérica). */
      for (const line of logs) {
        assert.ok(
          !line.includes(r.demoCode!),
          `código filtrado nos logs: ${line}`,
        );
      }
    } finally {
      console.info = orig;
      delete process.env.PA_DEMO;
    }
  });

  it("PA_DEMO=0 → sen demoCode e sen cifras nos logs", async () => {
    process.env.PA_DEMO = "0";
    delete process.env.SMTP_HOST;
    const { EmailOtpIdentityProvider } = await import("./email-otp.js");
    const otp = new EmailOtpIdentityProvider();
    const logs: string[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const r = await otp.login({
        method: "email_otp",
        identifier: "ana.demo@demo.pistaaberta.com",
        municipalityId: "muni-exemplo",
      });
      assert.ok(r.challengeId);
      assert.equal(r.demoCode, undefined);
      for (const line of logs) {
        assert.ok(
          !/\b\d{6}\b/.test(line),
          `non debe haber código de 6 cifras nos logs: ${line}`,
        );
      }
    } finally {
      console.info = orig;
      delete process.env.PA_DEMO;
    }
  });

  it("produción sen SMTP → erro e sen demoCode", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.PA_DEMO = "0";
    delete process.env.SMTP_HOST;
    const { EmailOtpIdentityProvider } = await import("./email-otp.js");
    const otp = new EmailOtpIdentityProvider();
    try {
      await assert.rejects(
        () =>
          otp.login({
            method: "email_otp",
            identifier: "cidada.nova@proba.gal",
            municipalityId: "muni-exemplo",
          }),
        /Non se puido enviar/,
      );
    } finally {
      process.env.NODE_ENV = prev;
      delete process.env.PA_DEMO;
    }
  });
});
