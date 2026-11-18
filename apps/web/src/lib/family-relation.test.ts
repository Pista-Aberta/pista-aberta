import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import gl from "../i18n/gl.json" with { type: "json" };
import es from "../i18n/es.json" with { type: "json" };
import {
  FAMILY_RELATIONS,
  formatFamilyRelation,
  isFamilyRelation,
  renderFamilyRelationLabel,
} from "./family-relation";

const here = path.dirname(fileURLToPath(import.meta.url));
const accountPagePath = path.resolve(here, "../pages/AccountPage.tsx");

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

test("P4: FAMILY_RELATIONS cobre fillo/filla/dependente/outro en gl e es", async () => {
  assert.deepEqual(FAMILY_RELATIONS, ["fillo", "filla", "dependente", "outro"]);
  for (const rel of FAMILY_RELATIONS) {
    assert.equal(isFamilyRelation(rel), true);
  }
  assert.equal(isFamilyRelation("primo"), false);
  assert.equal(isFamilyRelation(""), false);

  const tGl = await makeT("gl");
  const tEs = await makeT("es");

  assert.equal(formatFamilyRelation(tGl, "fillo"), "Fillo");
  assert.equal(formatFamilyRelation(tGl, "filla"), "Filla");
  assert.equal(formatFamilyRelation(tGl, "dependente"), "Dependente");
  assert.equal(formatFamilyRelation(tGl, "outro"), "Outro");

  assert.equal(formatFamilyRelation(tEs, "fillo"), "Hijo");
  assert.equal(formatFamilyRelation(tEs, "filla"), "Hija");
  assert.equal(formatFamilyRelation(tEs, "dependente"), "Dependiente");
  assert.equal(formatFamilyRelation(tEs, "outro"), "Otro");

  assert.equal(renderFamilyRelationLabel(tEs, "filla"), "Hija");
  assert.equal(renderFamilyRelationLabel(tGl, "custom"), "custom");
});

test("P4: AccountPage usa o selector de relación sen hardcodear relation: 'fillo'", () => {
  const src = fs.readFileSync(accountPagePath, "utf8");
  assert.doesNotMatch(src, /relation:\s*["']fillo["']/);
  assert.match(src, /FAMILY_RELATIONS\.map/);
  assert.match(src, /account\.familyRelationLabel/);
  assert.doesNotMatch(src, /\bimport\s*\(/);
});
