/**
 * Revisión 5 — A2/A3: rangos countTier + nomes INE JSON = GeoJSON.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = path.join(root, "data");

/** Rangos canónicos do mapa de instalacións (compartidos coa UI). */
function countTier(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 3) return 1;
  if (count <= 7) return 2;
  if (count <= 15) return 3;
  return 4;
}

const TIER_LABELS = ["0", "1–3", "4–7", "8–15", "16+"] as const;

describe("countTier rangos fixos", () => {
  it("mapea 0 / 1–3 / 4–7 / 8–15 / 16+ aos 5 tiers", () => {
    assert.equal(countTier(0), 0);
    assert.equal(countTier(1), 1);
    assert.equal(countTier(3), 1);
    assert.equal(countTier(4), 2);
    assert.equal(countTier(7), 2);
    assert.equal(countTier(8), 3);
    assert.equal(countTier(15), 3);
    assert.equal(countTier(16), 4);
    assert.equal(countTier(82), 4);
    assert.equal(TIER_LABELS.length, 5);
  });
});

describe("instalacions-por-concello vs geojson (INE)", () => {
  it("cada clave JSON coincide no nome co GeoJSON", () => {
    const inst = JSON.parse(
      fs.readFileSync(path.join(dataDir, "instalacions-por-concello.json"), "utf8"),
    ) as Record<
      string,
      {
        name: string;
        demo?: boolean;
        count: number;
        points?: unknown[];
        generatedAt?: string;
      }
    >;
    const geo = JSON.parse(
      fs.readFileSync(path.join(dataDir, "concellos.geojson"), "utf8"),
    ) as {
      features: Array<{ properties: { ine: string; name: string } }>;
    };

    const byIne = new Map(
      geo.features.map((f) => [f.properties.ine, f.properties.name]),
    );

    assert.equal(Object.keys(inst).length, 313);
    assert.equal(byIne.size, 313);

    const mismatches: string[] = [];
    for (const [ine, row] of Object.entries(inst)) {
      const geoName = byIne.get(ine);
      if (!geoName) {
        mismatches.push(`${ine}: falta no geojson`);
        continue;
      }
      if (geoName !== row.name) {
        mismatches.push(`${ine}: json="${row.name}" geo="${geoName}"`);
      }
    }
    assert.equal(mismatches.length, 0, mismatches.slice(0, 10).join("; "));

    // Censo real intacto: usamos Sarreaus (32078) nos asserts.
    assert.equal(inst["32078"]?.name, "Sarreaus");
    assert.notEqual(inst["32078"]?.demo, true);
    assert.equal(inst["15055"]?.name, "Neda");
    assert.notEqual(inst["15055"]?.demo, true);

    const sarreaus = inst["32078"]!;
    assert.ok(sarreaus.count > 0, "Sarreaus debe ter instalacións OSM");
    assert.ok(!("points" in sarreaus), "puntos van noutro ficheiro");

    const mainBytes = fs.statSync(path.join(dataDir, "instalacions-por-concello.json")).size;
    assert.ok(mainBytes < 150 * 1024, `JSON principal ${mainBytes} >= 150 kB`);

    const meta = JSON.parse(
      fs.readFileSync(path.join(dataDir, "instalacions-por-concello.meta.json"), "utf8"),
    ) as { _meta: { generatedAt: string; pointsFile: string } };
    assert.ok(typeof meta._meta.generatedAt === "string");
    assert.equal(meta._meta.pointsFile, "instalacions-puntos.json");

    const puntos = JSON.parse(
      fs.readFileSync(path.join(dataDir, "instalacions-puntos.json"), "utf8"),
    ) as Record<string, unknown[]>;
    assert.ok(Array.isArray(puntos["32078"]) && puntos["32078"]!.length > 0);
  });
});
