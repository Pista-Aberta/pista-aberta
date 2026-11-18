/**
 * REVISION-11 S5 / S2 / S6 — comprobacións estáticas de fonte.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const web = join(root, "apps/web/src");
const api = join(root, "apps/api/src");
const shared = join(root, "packages/shared/src");

function load(base: string, rel: string): string {
  return readFileSync(join(base, rel), "utf8");
}

describe("REVISION-11 S5 R4 Deputación", () => {
  it("DeputacionGate require superadmin (non demo pública)", () => {
    const gate = load(web, "components/DeputacionGate.tsx");
    assert.equal(gate.includes("resolveDemoMode"), false);
    assert.match(gate, /role !== "superadmin"/);
    assert.match(gate, /returnTo/);
  });

  it("DeputacionPage sen formulario Crear concello; só Asistente", () => {
    const page = load(web, "pages/DeputacionPage.tsx");
    assert.equal(page.includes("Crear concello"), false);
    assert.equal(page.includes("onCreate"), false);
    /* REVISION-39 L12: texto vía i18n. */
    assert.match(
      page,
      /deputacion\.onboardCta|deputacion\.addConcelloCta|Asistente de alta|Dar de alta un concello/,
    );
    assert.match(page, /alta-concello/);
  });

  it("persoa demo Deputación + barra de perfil", () => {
    const users = load(api, "identity/saml-users.ts");
    assert.match(users, /key:\s*"deputacion"/);
    assert.match(users, /role:\s*"superadmin"/);
    assert.match(users, /displayName:\s*"Deputación"/);
    const bar = load(web, "components/DemoProfileBar.tsx");
    assert.match(bar, /deputacion/);
    assert.match(bar, /demo\.bar\.deputacion/);
    const gl = load(web, "i18n/gl.json");
    assert.match(gl, /"demo\.bar\.deputacion": "Deputación"/);
    const roles = load(shared, "roles.ts");
    assert.match(roles, /case "superadmin":\s*return "\/deputacion"/);
  });
});

describe("REVISION-11 S5 R5 Horas tranquilas", () => {
  it("i18n sen &lt; literal na hint", () => {
    const gl = load(web, "i18n/gl.json");
    const es = load(web, "i18n/es.json");
    assert.equal(gl.includes("ocupación &lt;"), false);
    assert.equal(es.includes("ocupación &lt;"), false);
    /* REVISION-40 T12: texto en palabras, sen % crú. */
    assert.match(gl, /portada\.quietHoursHint": "[^"]*tranquilas/);
    assert.match(es, /portada\.quietHoursHint": "[^"]*tranquilas/);
  });

  it("semente ten historial pasado para quiet hours", () => {
    const seed = load(api, "store/seed.ts");
    assert.match(seed, /addDays\(today,\s*-i\)/);
    assert.match(seed, /i <= 28/);
  });
});

describe("REVISION-11 S5 R6 Porta e datas", () => {
  it("DoorCheckinPage amosa resumo da reserva", () => {
    const door = load(web, "pages/DoorCheckinPage.tsx");
    assert.match(door, /door\.bookingSummary/);
    assert.match(door, /door\.noReservationNext/);
    assert.match(door, /result\.facilityName/);
  });

  it("peches e peches Hoxe usan formatDate (non ISO cru)", () => {
    const admin = load(web, "pages/AdminPages.tsx");
    assert.match(admin, /formatDate\(c\.startsAt\.slice\(0,\s*10\)/);
    const melloras = load(web, "pages/AdminMellorasPages.tsx");
    /* REVISION-29 Y5: formatPecheLabel(d1 = startsAt.slice(0,10)). */
    assert.match(
      melloras,
      /formatDate\(\s*(?:p\.startsAt\.slice\(0,\s*10\)|d1)\s*(?:,|\))/,
    );
    assert.match(melloras, /startsAt\.slice\(0,\s*10\)/);
  });
});

describe("REVISION-11 S5 R7 pílulas", () => {
  it("SlotButton ten whitespace-nowrap", () => {
    const slot = load(web, "components/ui/SlotButton.tsx");
    assert.match(slot, /whitespace-nowrap/);
  });
});

describe("REVISION-11 S2 ficha instalacións", () => {
  it("ficha ten pestanas horarios/grupos/normas/cartel-qr embebedas", () => {
    const melloras = load(web, "pages/AdminMellorasPages.tsx");
    assert.match(melloras, /"grupos"/);
    assert.match(melloras, /"cartel-qr"/);
    assert.match(melloras, /AdminSchedulesEditorPage/);
    assert.match(melloras, /AdminFixedGroupsPage/);
    assert.match(melloras, /AdminRulesEditorPage sections="text"/);
    assert.match(melloras, /FacilityCartelQrTab/);
    assert.equal(
      melloras.includes('to={`/c/${slug}/admin/horarios?facility=${fac.id}') &&
        melloras.includes("admin.openSchedules"),
      false,
    );
  });

  it("menú Instalacións sen «e unidades»", () => {
    const gl = load(web, "i18n/gl.json");
    assert.match(gl, /"admin\.facilities": "Instalacións"/);
    assert.equal(gl.includes("Instalacións e unidades"), false);
  });

  it("normas sistema → Concello hub", () => {
    const app = load(web, "App.tsx");
    assert.match(
      app,
      /path="\/c\/:slug\/admin\/normas"[\s\S]*LegacyAdminHubRedirect[\s\S]*tab="normas"/,
    );
    const admin = load(web, "pages/AdminPages.tsx");
    assert.match(admin, /admin\.rulesGeneral/);
    assert.match(admin, /sections="system"/);
  });
});

describe("REVISION-11 S6 pequenos", () => {
  it("Club pestanas Pavillón/Tempada; sen ligazón Partidos self", () => {
    const gl = load(web, "i18n/gl.json");
    assert.match(gl, /"clubs\.home": "Pavillón"/);
    assert.match(gl, /"clubs\.season": "Tempada"/);
    const club = load(web, "pages/ClubPortalPage.tsx");
    assert.equal(club.includes("/partidos\""), false);
    assert.equal(club.includes("clubs.matches"), false);
  });

  it("MobileTabBar Reservas; calendario icona; conserxaría PA_DEMO", () => {
    const tab = load(web, "components/MobileTabBar.tsx");
    assert.match(tab, /tab\.reservas/);
    const bookings = load(web, "pages/MyBookingsPage.tsx");
    // REVISION-12 V3: calendario como icona á dereita do título (non pestana «Cal.»)
    assert.match(bookings, /bookings\.calendarTab/);
    assert.match(bookings, /aria-label=\{t\("bookings\.calendarTab"\)\}/);
    const staff = load(web, "pages/StaffCheckinPage.tsx");
    assert.match(staff, /VITE_PA_DEMO === "1"/);
    assert.equal(staff.includes("import.meta.env.DEV ||"), false);
  });

  it("Pavillón sen BackLink Inicio na páxina pública", () => {
    const pav = load(web, "pages/PavilionPage.tsx");
    assert.equal(pav.includes("BackLink"), false);
    assert.match(pav, /hideHeading/);
  });
});
