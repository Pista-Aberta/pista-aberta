/**
 * Rev3 D1–D3: incidencias, waitlist, grupos fixos.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-dfeat-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  createIncident,
  listIncidents,
  resolveIncident,
  openIncidentsCount,
} = await import("./incidents.js");
const {
  createFixedGroup,
  listFixedGroups,
  deactivateFixedGroup,
} = await import("./fixed-groups.js");
const { addWaitlist, listWaitlist } = await import("./extra.js");
const { addDaysIso, todayIso } = await import("./business-rules.js");

describe("melloras D1–D3 features", () => {
  const mid = "muni-exemplo";

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("D1: crear incidencia → listar → resolver", async () => {
    const before = await openIncidentsCount(mid);
    const created = await createIncident(
      mid,
      { id: "user-cidada", displayName: "Ana Demo" },
      {
        facilityId: "fac-exemplo-padel",
        body: "A porta do vestiario non pecha ben.",
      },
    );
    assert.ok(created);
    assert.equal(created!.status, "open");
    assert.ok(created!.body.includes("vestiario"));
    assert.equal(await openIncidentsCount(mid), before + 1);

    const open = await listIncidents(mid, { status: "open" });
    assert.ok(open.some((i) => i.id === created!.id));

    const resolved = await resolveIncident(mid, created!.id, "test-admin");
    assert.equal(resolved?.status, "done");
    assert.ok(resolved?.resolvedAt);
    assert.equal(await openIncidentsCount(mid), before);
  });

  it("D2: engadir á lista de espera", async () => {
    const { getDb } = await import("../db/client.js");
    const t = await import("../db/schema.js");
    const slotId = `slot-d2-wl-${Date.now().toString(36)}`;
    await getDb().insert(t.timeSlots).values({
      id: slotId,
      unitId: "unit-padel-1",
      municipalityId: mid,
      date: addDaysIso(todayIso(), 5),
      start: "05:15",
      end: "06:15",
      closed: false,
    });
    const entry = await addWaitlist({
      municipalityId: mid,
      slotId,
      userId: "user-cidada",
      userDisplayName: "Ana Demo",
    });
    assert.equal(entry.status, "waiting");
    const all = await listWaitlist(mid);
    assert.ok(all.some((w) => w.id === entry.id));
  });

  it("D3: crear grupo fixo → listar → desactivar", async () => {
    const from = todayIso();
    const to = addDaysIso(from, 90);
    const g = await createFixedGroup(mid, "test-admin", {
      name: "Escola de pádel luns",
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      weekday: 1,
      start: "17:00",
      end: "18:00",
      validFrom: from,
      validTo: to,
    });
    assert.equal(g.needsConfirm, false);
    if (g.needsConfirm) throw new Error("unexpected needsConfirm");
    assert.equal(g.active, true);
    assert.equal(g.name, "Escola de pádel luns");
    const listed = await listFixedGroups(mid);
    assert.ok(listed.some((x) => x.id === g.id));
    const off = await deactivateFixedGroup(mid, g.id, "test-admin");
    assert.equal(off.active, false);
  });
});
