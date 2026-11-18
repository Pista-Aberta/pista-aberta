/**
 * Static scrub: forbidden raw tokens / hardcoded demo IDs in admin TSX
 * that should have been replaced by Rev3 Block A UI.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.resolve(here, "../../../web/src/pages");

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkTsx(p));
    else if (ent.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("ui copy scrub (Rev3 A)", () => {
  it("AdminBookFor non usa fac-exemplo-padel hardcodeado", () => {
    const file = path.join(pagesDir, "AdminPages.tsx");
    const src = fs.readFileSync(file, "utf8");
    const bookFor = src.slice(
      src.indexOf("export function AdminBookForPage"),
      src.indexOf("export { AdminFacilitiesEditorPage"),
    );
    assert.ok(bookFor.length > 100, "AdminBookForPage non atopada");
    assert.equal(
      bookFor.includes("fac-exemplo-padel"),
      false,
      "AdminBookFor aínda hardcodea fac-exemplo-padel",
    );
    assert.equal(
      bookFor.includes("toISOString()"),
      false,
      "AdminBookFor non debe usar toISOString para a data local",
    );
  });

  it("AdminSolicitudes non dumpa JSON.stringify(r.payload)", () => {
    const file = path.join(pagesDir, "AdminMellorasPages.tsx");
    const src = fs.readFileSync(file, "utf8");
    assert.equal(
      src.includes("JSON.stringify(r.payload)"),
      false,
      "Solicitudes aínda mostra JSON.stringify do payload",
    );
  });

  it("páxinas admin non mostran unit-pav-full / PA--PAV como etiqueta visible", () => {
    const files = walkTsx(pagesDir).filter((f) =>
      /Admin|Staff|Reserve|QrPoster|Pavilion/.test(path.basename(f)),
    );
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      // JSX text / string literals used as visible labels (heuristic)
      if (/>\s*unit-pav-full\s*</.test(src) || />\s*PA--PAV\s*</.test(src)) {
        bad.push(path.basename(f));
      }
      if (src.includes('"fac-exemplo-padel"') && path.basename(f) === "AdminPages.tsx") {
        // allowed only outside AdminBookFor — already checked above
      }
    }
    assert.deepEqual(bad, []);
  });

  it("Rev4: QrPoster non usa PA-${id.slice}; Tempada/Indicadores resolven nomes", () => {
    const poster = fs.readFileSync(path.join(pagesDir, "QrPosterPage.tsx"), "utf8");
    assert.equal(
      poster.includes("f.id.slice"),
      false,
      "QrPoster aínda deriva o código do id interno",
    );
    const admin = fs.readFileSync(path.join(pagesDir, "AdminPages.tsx"), "utf8");
    const season = admin.slice(
      admin.indexOf("export function AdminSeasonPage"),
      admin.indexOf("export function AdminIndicatorsPage"),
    );
    assert.ok(season.includes("labelClub"), "Tempada debe mapear clubId → nome");
    assert.ok(season.includes("labelUnit"), "Tempada debe mapear unitId → nome");
    const ind = admin.slice(admin.indexOf("export function AdminIndicatorsPage"));
    assert.ok(ind.includes("labelUnit"), "Indicadores debe mapear unitId → nome");
  });

  it("Rev4: Importar partidos ten pageTitle; sen H2 duplicado en clubs/persoal/branding", () => {
    const melloras = fs.readFileSync(
      path.join(pagesDir, "AdminMellorasPages.tsx"),
      "utf8",
    );
    const importBlock = melloras.slice(melloras.indexOf("AdminMatchImportPage"));
    assert.ok(
      /pageTitle=\{t\("admin\.csvImport"\)\}/.test(importBlock),
      "Importar partidos sen pageTitle",
    );
    const admin = fs.readFileSync(path.join(pagesDir, "AdminPages.tsx"), "utf8");
    for (const key of ["admin.branding", "admin.staff", "admin.clubs"] as const) {
      const re = new RegExp(
        `pageTitle=\\{t\\("${key}"\\)\\}>\\s*<h2[^>]*>\\{t\\("${key}"\\)\\}`,
        "m",
      );
      assert.equal(re.test(admin), false, `H2 duplicado para ${key}`);
    }
  });
});
