/**
 * REVISION-11 S1 / S3 / S4 — comprobacións estáticas de fonte.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const web = join(root, "apps/web/src");

function load(rel: string): string {
  return readFileSync(join(web, rel), "utf8");
}

describe("REVISION-11 S1 hubs inline", () => {
  it("AdminPages non ten «Abrir a vista completa»", () => {
    const admin = load("pages/AdminPages.tsx");
    assert.equal(admin.includes("hubOpenPage"), false);
    assert.equal(admin.includes("Abrir a vista completa"), false);
    assert.match(admin, /AdminEmbed/);
    assert.match(admin, /AdminPavilionPage/);
    assert.match(admin, /AdminIndicatorsPage/);
  });

  it("rutas vellas redirixen a hub?tab=", () => {
    const app = load("App.tsx");
    assert.match(app, /LegacyAdminHubRedirect/);
    assert.match(app, /hub="clubs-pavillon"[\s\S]*tab="pavillon"/);
    assert.match(app, /hub="concello"[\s\S]*tab="indicadores"/);
    assert.match(app, /path="\/c\/:slug\/admin\/exportar"[\s\S]*LegacyAdminHubRedirect/);
    assert.match(app, /path="\/c\/:slug\/admin\/persoas"[\s\S]*tab="persoas"/);
  });
});

describe("REVISION-11 S3 Reservar hub", () => {
  it("ReservarHub sen type=date nin BackLink; chips compactos + DayTile", () => {
    const hub = load("pages/ReservarHubPage.tsx");
    assert.equal(/type=["']date["']/.test(hub), false);
    assert.equal(hub.includes("BackLink"), false);
    assert.match(hub, /DayTile/);
    assert.match(hub, /h-10/);
    /* Rev25 C7: tarxeta compartida cos chips verdes do patrón Inicio */
    assert.match(hub, /FacilityFreeCard/);
    const card = load("components/FacilityFreeCard.tsx");
    assert.match(card, /CourtArt/);
    assert.match(card, /state="libre"/);
  });
});

describe("REVISION-11 S4 Panel Hoxe", () => {
  it("Hoxe embebe lista do día e só dous botóns de atallo", () => {
    const admin = load("pages/AdminPages.tsx");
    assert.match(admin, /AdminDayBookingsPanel/);
    assert.match(admin, /function AdminHomePage/);
    const homeStart = admin.indexOf("export function AdminHomePage");
    const homeEnd = admin.indexOf("function AdminDayBookingsPanel");
    const home = admin.slice(homeStart, homeEnd);
    assert.match(home, /AdminDayBookingsPanel/);
    assert.match(home, /admin\.bookFor/);
    assert.match(home, /admin\.newClosure/);
    assert.equal(home.includes("staff.checkin"), false);
    assert.equal(home.includes("admin.dayBookings"), true); // título da sección
    // Sen atallo a /admin/reservas
    assert.equal(home.includes("/admin/reservas"), false);
    assert.equal(home.includes("/conserxeria"), false);
  });

  it("DayLineGantt rango dinámico apertura→peche + scroll", () => {
    const gantt = load("components/DayLineGantt.tsx");
    assert.match(gantt, /FALLBACK_START\s*=\s*8/);
    assert.match(gantt, /FALLBACK_END\s*=\s*22/);
    assert.match(gantt, /dayStartHour/);
    assert.match(gantt, /overflow-x-auto/);
    assert.equal(gantt.includes("min-w-[720px]"), false);
  });
});
