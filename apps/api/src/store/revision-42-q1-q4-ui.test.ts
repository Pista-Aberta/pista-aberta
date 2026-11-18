/**
 * REVISION-42 Q1/Q3/Q4 — comprobacións estáticas UI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const web = (...p: string[]) => join(root, "apps/web/src", ...p);

describe("REVISION-42 Q1 FacilityFreeCard", () => {
  it("seeAllHref é Link real; hub sen envolver a tarxeta", () => {
    const card = readFileSync(web("components/FacilityFreeCard.tsx"), "utf8");
    const hub = readFileSync(web("pages/ReservarHubPage.tsx"), "utf8");
    const portada = readFileSync(web("pages/MunicipalityPage.tsx"), "utf8");
    assert.match(card, /seeAllHref/);
    assert.match(card, /<Link[\s\S]*to=\{seeAllHref\}/);
    assert.match(portada, /seeAllHref=\{`\/c\/\$\{slug\}\/reservar/);
    assert.match(hub, /seeAllHref=\{facilityHref\}/);
    assert.doesNotMatch(
      hub,
      /<Link[\s\S]{0,200}FacilityFreeCard[\s\S]{0,400}<\/Link>/,
    );
  });
});

describe("REVISION-42 Q3 ComoChegar sen iframe", () => {
  it("non hai iframe OSM; só botón mapa", () => {
    const como = readFileSync(web("components/ComoChegarSection.tsx"), "utf8");
    assert.doesNotMatch(como, /<iframe/);
    assert.doesNotMatch(como, /osmEmbedUrl/);
    assert.match(como, /mobileMapUrl/);
    assert.match(como, /como-chegar-open-map/);
  });
});

describe("REVISION-42 Q4 cabeceira compacta", () => {
  it("avatar só iniciais; Saír só no menú; Contacto hideBelowWide", () => {
    const menu = readFileSync(web("components/UserMenu.tsx"), "utf8");
    const header = readFileSync(web("components/BrandShellHeader.tsx"), "utf8");
    const citizen = readFileSync(web("components/CitizenHeader.tsx"), "utf8");
    assert.doesNotMatch(menu, /user-menu-exit-desktop/);
    assert.match(menu, /aria-label=\{`\$\{initials\}\. \$\{user\.displayName\}`\}/);
    assert.match(header, /hideBelowWide/);
    assert.match(header, /max-\[1359px\]:hidden/);
    assert.match(citizen, /hideBelowWide:\s*true/);
    assert.match(menu, /nav\.contact/);
    /* Altura visual: trigger h-11 (44) + py-3 (24) ≈ 68 ≤ 80. */
    assert.match(header, /py-3/);
    assert.match(menu, /h-11 w-11/);
  });
});

describe("REVISION-42 Q5 partido sen sesión", () => {
  it("botón identificar; sen casilla; sen Organizador —", () => {
    const detail = readFileSync(web("pages/OpenMatchDetailPage.tsx"), "utf8");
    assert.match(detail, /openMatch\.identifyToJoin/);
    assert.match(detail, /open-match-identify/);
    assert.match(detail, /spotsOccupiedAnon/);
    assert.match(detail, /canJoin && !user/);
    assert.match(detail, /canJoin && user/);
    assert.doesNotMatch(detail, /organizerName \?\? "—"/);
  });
});

describe("REVISION-42 Q8 menores UI", () => {
  it("cancel peril + leave_too_late", () => {
    const detail = readFileSync(web("pages/OpenMatchDetailPage.tsx"), "utf8");
    assert.match(detail, /variant=\"danger\"/);
    assert.match(detail, /leave_too_late/);
    assert.match(detail, /error\.leave_too_late/);
  });
});
