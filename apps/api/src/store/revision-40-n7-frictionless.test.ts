/**
 * REVISION-40 N7 — Frictionless: táboas principais + audit export.personal.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { inflateRawSync } from "node:zlib";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-r40-n7-"));
process.env.PGLITE_DATA_DIR = tmp;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.SESSION_SECRET = "test-secret-r40-n7";
delete process.env.DATABASE_URL;

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const { getMunicipalityBySlug } = await import("./db.js");
const { buildFrictionlessZip } = await import("./frictionless-zip.js");
const { listAudit } = await import("./extra.js");

function unzipNames(buf: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    names.push(name);
    offset += 30 + nameLen + extraLen + compSize;
    void method;
    void inflateRawSync;
  }
  return names;
}

describe("REVISION-40 N7 frictionless", () => {
  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("ZIP leva táboas principais", async () => {
    const exemplo = await getMunicipalityBySlug("exemplo");
    assert.ok(exemplo);
    const { buffer, filename } = await buildFrictionlessZip(exemplo.id);
    assert.match(filename, /frictionless\.zip$/);
    const names = unzipNames(buffer);
    for (const need of [
      "datapackage.json",
      "data/instalacions.csv",
      "data/instalacions.geojson",
      "data/unidades.csv",
      "data/horarios.csv",
      "data/peches.csv",
      "data/actividades.csv",
      "data/clubs.csv",
    ]) {
      assert.ok(names.includes(need), `falta ${need} en ${names.join(",")}`);
    }
    const dpIdx = names.indexOf("datapackage.json");
    assert.ok(dpIdx >= 0);
    // ler datapackage do zip (local header + payload)
    let offset = 0;
    let dpRaw: Buffer | null = null;
    const buf = buffer;
    while (offset + 30 <= buf.length) {
      const sig = buf.readUInt32LE(offset);
      if (sig !== 0x04034b50) break;
      const method = buf.readUInt16LE(offset + 8);
      const compSize = buf.readUInt32LE(offset + 18);
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
      const start = offset + 30 + nameLen + extraLen;
      const payload = buf.subarray(start, start + compSize);
      if (name === "datapackage.json") {
        dpRaw = method === 8 ? inflateRawSync(payload) : payload;
        break;
      }
      offset = start + compSize;
    }
    assert.ok(dpRaw);
    const dp = JSON.parse(dpRaw!.toString("utf8")) as {
      resources: Array<{ name: string; schema?: { fields?: unknown[] } }>;
    };
    const withSchema = dp.resources.filter((r) => (r.schema?.fields?.length ?? 0) > 0);
    assert.ok(withSchema.length >= 3, "datapackage debe levar schema.fields");
    const geo = dp.resources.find((r) => r.name === "instalacions-geojson");
    assert.ok(geo, "falta recurso instalacions-geojson");
  });

  it("persoais=1 → persoas.csv + audit export.personal", async () => {
    const exemplo = await getMunicipalityBySlug("exemplo");
    assert.ok(exemplo);
    await buildFrictionlessZip(exemplo.id, {
      persoais: true,
      actor: "Admin Test",
    });
    const rows = await listAudit(exemplo.id);
    assert.ok(
      rows.some((r) => r.action === "export.personal"),
      "falta audit export.personal",
    );
  });
});
