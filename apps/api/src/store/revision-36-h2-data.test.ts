/**
 * REVISION-36 H2 — data/ accesible onde o código a busca; Terceiro (32078) ten puntos.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const STORE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** municipality-launch / census / facility-admin-templates: 4 niveis ↑ → monorepo. */
const REPO_FROM_STORE = path.resolve(STORE_DIR, "../../../..");
/** setup-muni.ts: desde apps/api/scripts, 3 niveis ↑ → monorepo. */
const REPO_FROM_SCRIPTS = path.resolve(STORE_DIR, "../../scripts/../../..");
const REPO_ROOT = REPO_FROM_STORE;

describe("REVISION-36 H2 data/ censo", () => {
  it("Dockerfile copia data ./data", () => {
    const df = fs.readFileSync(
      path.join(REPO_ROOT, "apps/api/Dockerfile"),
      "utf8",
    );
    assert.match(df, /COPY data \.\/data/);
  });

  it("resolvers store e scripts apuntan á mesma raíz con data/", () => {
    assert.equal(
      path.resolve(REPO_FROM_STORE),
      path.resolve(REPO_FROM_SCRIPTS),
    );
    for (const rel of [
      "data/instalacions-puntos.json",
      "data/concellos-lista.json",
      "data/instalacions-por-concello.json",
    ]) {
      assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `falta ${rel}`);
    }
  });

  it("Terceiro INE 32078 ten ≥1 punto con coordenadas", () => {
    const puntos = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "data/instalacions-puntos.json"),
        "utf8",
      ),
    ) as Record<string, [number, number, string][]>;
    const pts = puntos["32078"];
    assert.ok(Array.isArray(pts) && pts.length > 0, "Terceiro sen puntos");
    assert.ok(Number.isFinite(pts[0]![0]) && Number.isFinite(pts[0]![1]));
  });
});
