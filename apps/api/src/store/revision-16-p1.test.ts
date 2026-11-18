/**
 * Revision 16 P1 — unha identidade, illamento por concello.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r16-p1-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-revision-16-p1";
delete process.env.DATABASE_URL;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { createBooking, listBookings, listSlots } = await import("./db.js");
const { slotDateTime } = await import("./business-rules.js");
const { demoUsersForSlug } = await import("../identity/saml-users.js");
const { citizenMayCrossMunicipality } = await import("@pista-aberta/shared");

async function freeSlot(municipalityId: string, facilityId: string) {
  const slots = await listSlots({ municipalityId, facilityId });
  const now = new Date();
  const free = slots.find((s) => {
    if (s.occupied || s.closed) return false;
    return slotDateTime(s.date, s.start).getTime() > now.getTime();
  });
  assert.ok(free, `sen franxa libre en ${facilityId}`);
  return free;
}

describe("revision-16 P1 identidade multi-concello", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("citizenMayCrossMunicipality require personIdentifier", () => {
    assert.equal(citizenMayCrossMunicipality("citizen", "ES/ES/1"), true);
    assert.equal(citizenMayCrossMunicipality("citizen", null), false);
    assert.equal(citizenMayCrossMunicipality("admin", "ES/ES/1"), false);
  });

  it("demo IdP: Ana (cidada) aparece en Proba e Exemplo", () => {
    const exemplo = demoUsersForSlug("exemplo").map((u) => u.key);
    const ex = demoUsersForSlug("proba").map((u) => u.key);
    assert.ok(exemplo.includes("cidada"));
    assert.ok(ex.includes("cidada"));
    assert.ok(ex.includes("admin-proba"));
    assert.equal(ex.includes("admin"), false);
  });

  it("Ana reserva en Exemplo e Proba; listBookings illa por municipalityId", async () => {
    const exemploSlot = await freeSlot("muni-exemplo", "fac-exemplo-padel");
    const exSlot = await freeSlot("muni-proba", "fac-proba-sala");

    const bExemplo = await createBooking({
      municipalityId: "muni-exemplo",
      slotId: exemploSlot.id,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
    });
    const bEx = await createBooking({
      municipalityId: "muni-proba",
      slotId: exSlot.id,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
    });

    const listedExemplo = await listBookings({
      municipalityId: "muni-exemplo",
      userId: "user-cidada",
    });
    const listedEx = await listBookings({
      municipalityId: "muni-proba",
      userId: "user-cidada",
    });

    assert.ok(listedExemplo.some((b) => b.id === bExemplo.id));
    assert.equal(
      listedExemplo.some((b) => b.id === bEx.id),
      false,
      "reserva de Proba non debe saír na lista de Exemplo",
    );
    assert.ok(listedEx.some((b) => b.id === bEx.id));
    assert.equal(
      listedEx.some((b) => b.id === bExemplo.id),
      false,
      "reserva de Exemplo non debe saír na lista de Proba",
    );
  });
});
