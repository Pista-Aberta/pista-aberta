/**
 * REVISION-49 Z7 — freeSlotStarts: ≤3/día, :00/:30, incl. domingo.
 * Comproba o fonte (sen importar apps/web, que rompe rootDir do api).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../web/src/lib/move-match.ts",
  ),
  "utf8",
);

describe("REVISION-49 Z7 freeSlotStarts repartidas", () => {
  it("fonte: perDay 3, paso 30 min (:00/:30), bucle por días", () => {
    assert.match(src, /perDay\s*=\s*opts\.perDay\s*\?\?\s*3/);
    assert.match(src, /start \+= 30/);
    assert.match(src, /open % 30/);
    assert.match(src, /for \(const date of opts\.days\)/);
    assert.match(src, /REVISION-49 Z7/);
  });
});
