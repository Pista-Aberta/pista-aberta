/**
 * SIMPLIFICACION — rutas vellas redirixen (Navigate replace) e menú panel = 6.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("simplificación redirects e panel", () => {
  it("rutas vellas usan Navigate replace", () => {
    const facilities = readFileSync(
      join(root, "apps/web/src/pages/FacilitiesPage.tsx"),
      "utf8",
    );
    assert.match(facilities, /Navigate[\s\S]*replace/);
    assert.match(facilities, /\/reservar/);

    const weekend = readFileSync(
      join(root, "apps/web/src/pages/WeekendPublicPage.tsx"),
      "utf8",
    );
    assert.match(weekend, /Navigate[\s\S]*pavillon[\s\S]*replace/);

    const app = readFileSync(join(root, "apps/web/src/App.tsx"), "utf8");
    assert.match(app, /path="\/plataforma"[\s\S]*Navigate[\s\S]*replace/);
    assert.match(app, /path="\/admin\/deputacion"[\s\S]*Navigate[\s\S]*replace/);
    /* Rev24 T3: folla imprimible real (StaffSheetPage), non redirect á conserxaría */
    assert.match(app, /folla-conserxe[\s\S]*StaffSheetPage/);
    assert.match(app, /clubs\/:clubId\/partidos[\s\S]*Navigate/);
    assert.match(app, /AdminClubsPavilionPage/);
    assert.match(app, /AdminConcelloPage/);
  });

  it("panel ten 6 entradas planas", () => {
    const admin = readFileSync(
      join(root, "apps/web/src/pages/AdminPages.tsx"),
      "utf8",
    );
    assert.match(admin, /6 entradas planas/);
    const groupsFn = admin.slice(
      admin.indexOf("function buildAdminNavGroups"),
      admin.indexOf("function groupContainsActive"),
    );
    const hubs = groupsFn.match(/hubPath:/g) ?? [];
    assert.equal(hubs.length, 6);
    assert.match(admin, /clubs-pavillon/);
    assert.match(admin, /hubPath: "concello"/);
    assert.doesNotMatch(admin, /onOpenSearch/);
  });

  it("Ana: Inicio → deporte → hora (ReservarHub + portada chips)", () => {
    const hub = readFileSync(
      join(root, "apps/web/src/pages/ReservarHubPage.tsx"),
      "utf8",
    );
    assert.match(hub, /goHour/);
    assert.match(hub, /setDeporte/);
    const muni = readFileSync(
      join(root, "apps/web/src/pages/MunicipalityPage.tsx"),
      "utf8",
    );
    assert.match(muni, /reservar\?deporte=/);
    assert.doesNotMatch(muni, /portada\.seeFree/);
  });
});
