/**
 * SIMPLIFICACION §6 + Acceso certificado dixital sempre visible.
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

function loadI18n(lang: "gl" | "es"): Record<string, string> {
  return JSON.parse(
    readFileSync(join(web, `i18n/${lang}.json`), "utf8"),
  ) as Record<string, string>;
}

describe("SIMPLIFICACION §6 limpeza visual", () => {
  it("Card lift por defecto é false (borde sen sombra)", () => {
    const src = load("components/ui/Card.tsx");
    assert.match(src, /lift\s*=\s*false/);
  });

  it("páxinas cidadás usan BackLink e non «Portal municipal» / migas", () => {
    for (const f of [
      "pages/ReservePage.tsx",
      "pages/IncidentPage.tsx",
      "pages/LoginPage.tsx",
      "pages/EasyReadPage.tsx",
      "pages/CertificadoInfoPage.tsx",
    ]) {
      const src = load(f);
      assert.match(src, /BackLink/, `${f} debe importar BackLink`);
      assert.equal(src.includes("muni.portal"), false, `${f} aínda di Portal municipal`);
      assert.equal(src.includes("login.backHome"), false, `${f} aínda di Volver á portada`);
      assert.equal(src.includes("login.breadcrumb"), false, `${f} aínda ten migas`);
    }
  });

  it("copy técnico §6 eliminado ou suavizado", () => {
    const gl = loadI18n("gl");
    const es = loadI18n("es");
    assert.equal(gl["home.pickLabel"], undefined);
    assert.equal(es["home.pickLabel"], undefined);
    assert.equal(gl["admin.occupancyHint"]?.includes("datos do día"), false);
    assert.equal(gl["admin.rulesHintEdit"]?.includes("GL/ES"), false);
    const db = readFileSync(join(root, "apps/api/src/store/db.ts"), "utf8");
    assert.equal(db.includes("sen IA"), false);
    assert.equal(db.includes("regras estatísticas"), false);
  });
});

describe("Acceso: certificado dixital sempre visible", () => {
  it("LoginPage amosa tarxeta cert con Recomendado no PC e sen Chave365", () => {
    const src = load("pages/LoginPage.tsx");
    assert.match(src, /data-testid="login-cert-card"/);
    assert.match(src, /t\("login\.cert"\)/);
    assert.match(src, /login\.cert\.subDesktop/);
    assert.match(src, /login\.recommended/);
    assert.match(src, /order-2 md:order-1/); // cert primeiro no PC
    assert.match(src, /acceso\/certificado/);
    assert.equal(/Chave365|chave365/i.test(src), false);
    assert.equal(/logo.*[Xx]unta|[Xx]unta.*logo/.test(src), false);
  });

  it("i18n mantén título completo do certificado", () => {
    const gl = loadI18n("gl");
    const es = loadI18n("es");
    assert.equal(gl["login.cert"], "Certificado dixital ou DNIe");
    assert.equal(es["login.cert"], "Certificado digital o DNIe");
  });

  it("CertificadoInfoPage conserva returnTo e BackLink a Acceso", () => {
    const src = load("pages/CertificadoInfoPage.tsx");
    assert.match(src, /BackLink/);
    assert.match(src, /returnTo/);
    assert.match(src, /\/acceso\?returnTo=/);
  });
});
