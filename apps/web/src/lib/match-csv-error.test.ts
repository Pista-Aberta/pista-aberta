import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import gl from "../i18n/gl.json" with { type: "json" };
import es from "../i18n/es.json" with { type: "json" };
import {
  MATCH_CSV_ERROR_CODES,
  formatMatchCsvErrorCode,
  isMatchCsvErrorCode,
  renderMatchCsvErrorLabel,
} from "./match-csv-error";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminMellorasPath = path.resolve(here, "../pages/AdminMellorasPages.tsx");

async function makeT(lng: "gl" | "es") {
  const inst = i18next.createInstance();
  await inst.init({
    lng,
    fallbackLng: "gl",
    interpolation: { escapeValue: false },
    resources: {
      gl: { translation: gl },
      es: { translation: es },
    },
  });
  return inst.getFixedT(lng);
}

test("Q1 & Q2: MATCH_CSV_ERROR_CODES cobre bad_range e ambiguous_club en gl e es", async () => {
  assert.ok(MATCH_CSV_ERROR_CODES.includes("bad_range"));
  assert.ok(MATCH_CSV_ERROR_CODES.includes("ambiguous_club"));
  assert.equal(isMatchCsvErrorCode("bad_range"), true);
  assert.equal(isMatchCsvErrorCode("ambiguous_club"), true);
  assert.equal(isMatchCsvErrorCode("non_existent_code"), false);

  const tGl = await makeT("gl");
  const tEs = await makeT("es");

  assert.equal(
    formatMatchCsvErrorCode(tGl, "bad_range"),
    "A hora de fin debe ser posterior á de inicio",
  );
  assert.equal(
    formatMatchCsvErrorCode(tEs, "bad_range"),
    "La hora de fin debe ser posterior a la de inicio",
  );
  assert.equal(
    formatMatchCsvErrorCode(tGl, "ambiguous_club"),
    "Club ambiguo (máis dunha coincidencia)",
  );
  assert.equal(
    formatMatchCsvErrorCode(tEs, "ambiguous_club"),
    "Club ambiguo (más de una coincidencia)",
  );

  for (const code of MATCH_CSV_ERROR_CODES) {
    const glText = renderMatchCsvErrorLabel(tGl, code);
    const esText = renderMatchCsvErrorLabel(tEs, code);
    assert.notEqual(glText, code);
    assert.notEqual(esText, code);
    assert.equal(glText.startsWith("admin.csvErr."), false);
    assert.equal(esText.startsWith("admin.csvErr."), false);
  }

  assert.equal(
    renderMatchCsvErrorLabel(tGl, "missing_headers:date,start"),
    "Faltan columnas obrigatorias",
  );
  assert.equal(
    renderMatchCsvErrorLabel(tEs, "missing_headers:date,start"),
    "Faltan columnas obligatorias",
  );
  assert.equal(renderMatchCsvErrorLabel(tGl, "custom_unknown"), "custom_unknown");
});

test("AdminMatchImportPage usa renderMatchCsvErrorLabel sen inline imports", () => {
  const src = fs.readFileSync(adminMellorasPath, "utf8");
  assert.match(src, /renderMatchCsvErrorLabel\(t,\s*code\)/);
  assert.doesNotMatch(src, /\bimport\s*\(/);
});
