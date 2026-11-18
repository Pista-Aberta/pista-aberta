/**
 * REVISION-43 R2 — validación de displayName e escape CSV.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertDisplayNameForMatch,
  csvEscapeCell,
  isValidDisplayName,
} from "@pista-aberta/shared";

describe("REVISION-43 R2 displayName", () => {
  it("acepta nomes con tiles, ñ, punto, guión e apóstrofo", () => {
    assert.equal(assertDisplayNameForMatch("Ana R."), "Ana R.");
    assert.equal(assertDisplayNameForMatch("Pedro Núñez"), "Pedro Núñez");
    assert.equal(assertDisplayNameForMatch("María-José O'Neill"), "María-José O'Neill");
  });

  it("rexeita XSS, fórmulas e http", () => {
    for (const bad of [
      "<img src=x onerror=alert(1)>",
      "=cmd|'/C calc'!A0",
      "+1234",
      "-sum",
      "@foo",
      "http://evil.example",
      "a@b",
      "A < B",
      "x".repeat(41),
      "A",
    ]) {
      assert.equal(isValidDisplayName(bad), false, bad);
      assert.throws(
        () => assertDisplayNameForMatch(bad),
        /invalid_display_name|display_name_required/,
      );
    }
  });

  it("csvEscapeCell prefixa fórmulas", () => {
    assert.equal(csvEscapeCell("Ana"), '"Ana"');
    assert.equal(csvEscapeCell("=1+1"), "\"'=1+1\"");
    assert.equal(csvEscapeCell("+hi"), "\"'+hi\"");
    assert.equal(csvEscapeCell("-x"), "\"'-x\"");
    assert.equal(csvEscapeCell("@x"), "\"'@x\"");
    assert.equal(csvEscapeCell('di "to"'), '"di ""to"""');
  });
});
