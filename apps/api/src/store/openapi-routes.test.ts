/**
 * TANDA-1 — OpenAPI paths deben existir no código (e viceversa para paths documentados).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiDocument } from "../openapi.js";

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, "..");

function collectRouteSources(): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) {
        if (name.name === "node_modules" || name.name === "dist") continue;
        walk(p);
      } else if (/\.(ts|js)$/.test(name.name) && !name.name.endsWith(".test.ts")) {
        files.push(p);
      }
    }
  };
  walk(apiSrc);
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

function normalizePath(p: string): string {
  return p.replace(/\{([^}]+)\}/g, ":$1");
}

describe("OpenAPI paths ⊆ rutas código", () => {
  it("cada path OpenAPI aparece como ruta Hono no código", () => {
    const src = collectRouteSources();
    const missing: string[] = [];
    for (const raw of Object.keys(openApiDocument.paths ?? {})) {
      const asParam = normalizePath(raw);
      const needleA = `"${raw}"`;
      const needleB = `"${asParam}"`;
      const needleC = `'${asParam}'`;
      if (
        !src.includes(needleA) &&
        !src.includes(needleB) &&
        !src.includes(needleC) &&
        !src.includes(asParam)
      ) {
        missing.push(raw);
      }
    }
    assert.deepEqual(missing, [], `OpenAPI sen ruta no código: ${missing.join(", ")}`);
  });
});
