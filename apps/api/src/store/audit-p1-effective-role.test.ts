import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-audit-p1-role-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-audit-p1-role";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createSession } = await import("../identity/sessions.js");
const { grantUserRole } = await import("./user-roles.js");
const { completeRoutes } = await import("../routes/complete.js");
const { createBookingWithOpenMatch } = await import("./open-matches.js");
const { listSlots } = await import("./db.js");
const { slotDateTime } = await import("./business-rules.js");

const app = new Hono();
app.route("/", completeRoutes);

let matchId: string;
let monitorCookie: string;
let adminCookie: string;

async function cookieWithMuniRole(
  id: string,
  role: "monitor" | "admin",
): Promise<string> {
  const sid = await createSession({
    id,
    municipalityId: "muni-proba",
    municipalitySlug: "proba",
    role: "admin",
    displayName: `Admin ${role}`,
    email: `${id}@example.test`,
    locale: "gl",
  });
  await grantUserRole({
    userId: id,
    municipalityId: "muni-exemplo",
    role,
  });
  return `pa_sesion=${sid}`;
}

describe("audit P1.1: privilexios segundo rol efectivo do concello", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();

    const slots = await listSlots({
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-padel",
    });
    const min = Date.now() + 3 * 3_600_000;
    const slot = slots.find(
      (candidate) =>
        !candidate.closed &&
        !candidate.occupied &&
        slotDateTime(candidate.date, candidate.start).getTime() > min,
    );
    assert.ok(slot, "franxa libre para o partido de regresión");
    const { match } = await createBookingWithOpenMatch({
      municipalityId: "muni-exemplo",
      slotId: slot.id,
      userId: "user-cidada",
      displayName: "Ana Demo",
      nameDisplayConsent: true,
      title: "Partido illamento de roles",
    });
    matchId = match.id;
    monitorCookie = await cookieWithMuniRole("audit-raw-admin-monitor", "monitor");
    adminCookie = await cookieWithMuniRole("audit-effective-admin", "admin");
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("admin principal + monitor efectivo non pode obter o QR alleo; admin efectivo si", async () => {
    const monitor = await app.request(
      `/api/c/exemplo/partidos-abertos/${matchId}/qr`,
      { headers: { Cookie: monitorCookie } },
    );
    assert.equal(monitor.status, 403);

    const admin = await app.request(
      `/api/c/exemplo/partidos-abertos/${matchId}/qr`,
      { headers: { Cookie: adminCookie } },
    );
    assert.equal(admin.status, 200);
  });

  it("admin principal + monitor efectivo non pode cancelar como admin; admin efectivo si", async () => {
    const monitor = await app.request(
      `/api/c/exemplo/partidos-abertos/${matchId}/cancelar`,
      {
        method: "POST",
        headers: {
          Cookie: monitorCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "Acción administrativa" }),
      },
    );
    assert.equal(monitor.status, 403);

    const admin = await app.request(
      `/api/c/exemplo/partidos-abertos/${matchId}/cancelar`,
      {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "Cancelación válida" }),
      },
    );
    assert.equal(admin.status, 200);
  });
});
