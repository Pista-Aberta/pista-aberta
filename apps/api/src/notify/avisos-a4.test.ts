/**
 * REVISION-22 A4 — preferencias, token de baixa, cabeceiras List-Unsubscribe.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-avisos-a4-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-22-a4";

const { initDb, closeDb, getDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  defaultNotifyPrefs,
  normalizeNotifyPrefs,
  derivedNotifyFlags,
  disableAllEmail,
  shouldNotify,
} = await import("./prefs.js");
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = await import("./unsubscribe.js");
const { prepareMail } = await import("./mail.js");
const { updateNotifyPrefs } = await import("../store/rev4-ops.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

describe("REVISION-22 A4 avisos", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("defaults: toda a matriz activada", () => {
    const prefs = defaultNotifyPrefs();
    assert.equal(prefs.confirmacion.email, true);
    assert.equal(prefs.partido_club.inApp, true);
    const flags = derivedNotifyFlags(prefs);
    assert.equal(flags.notifyEmail, true);
    assert.equal(flags.notifyReminders, true);
  });

  it("token de baixa asinado verifica e rexeita basura", () => {
    const token = signUnsubscribeToken("user-cidada");
    assert.equal(verifyUnsubscribeToken(token), "user-cidada");
    assert.equal(verifyUnsubscribeToken("nope"), null);
    assert.equal(verifyUnsubscribeToken(`${token}x`), null);
  });

  it("prepareMail engade List-Unsubscribe e rodapé", () => {
    const url = "http://localhost:3001/api/avisos/baixa?token=abc";
    const prepared = prepareMail({
      to: "a@b.c",
      subject: "Proba",
      text: "Corpo",
      unsubscribeUrl: url,
    });
    assert.equal(prepared.headers["List-Unsubscribe"], `<${url}>`);
    assert.equal(
      prepared.headers["List-Unsubscribe-Post"],
      "List-Unsubscribe=One-Click",
    );
    assert.match(prepared.text, /Non quero recibir estes avisos/);
    assert.match(prepared.html, /Non quero recibir estes avisos/);
  });

  it("OTP / sen unsubscribeUrl non leva cabeceiras", () => {
    const prepared = prepareMail({
      to: "a@b.c",
      subject: "Código",
      text: "123456",
    });
    assert.equal(prepared.headers["List-Unsubscribe"], undefined);
  });

  it("updateNotifyPrefs + shouldNotify respectan a matriz", async () => {
    const userId = "user-cidada";
    const prefs = normalizeNotifyPrefs({
      ...defaultNotifyPrefs(),
      recordatorio: { email: false, inApp: false },
      cancelacion: { email: false, inApp: true },
    });
    await updateNotifyPrefs(userId, { notifyPrefs: prefs });
    const row = (
      await getDb().select().from(t.users).where(eq(t.users.id, userId)).limit(1)
    )[0]!;
    assert.equal(shouldNotify(row.notifyPrefs, "recordatorio", "email"), false);
    assert.equal(shouldNotify(row.notifyPrefs, "cancelacion", "inApp"), true);
    assert.equal(shouldNotify(row.notifyPrefs, "confirmacion", "email"), true);
    assert.equal(row.notifyReminders, false);

    const disabled = disableAllEmail(normalizeNotifyPrefs(row.notifyPrefs));
    await updateNotifyPrefs(userId, { notifyPrefs: disabled });
    const row2 = (
      await getDb().select().from(t.users).where(eq(t.users.id, userId)).limit(1)
    )[0]!;
    assert.equal(row2.notifyEmail, false);
    assert.equal(shouldNotify(row2.notifyPrefs, "confirmacion", "email"), false);
  });
});
