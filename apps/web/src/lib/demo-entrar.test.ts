import assert from "node:assert/strict";
import test from "node:test";
import {
  demoEntrarAlias,
  demoEntrarRelay,
  demoEntrarUserKey,
  isDemoEntrarPerfil,
  normalizeDemoEntrarPerfil,
} from "./demo-entrar";

test("demo entrar: perfís válidos e alias SAML", () => {
  assert.equal(isDemoEntrarPerfil("vecina"), true);
  assert.equal(isDemoEntrarPerfil("conserxaria"), true);
  assert.equal(isDemoEntrarPerfil("admin"), false);
  assert.equal(demoEntrarAlias("vecina"), "cidada");
  assert.equal(demoEntrarAlias("concello"), "admin");
  assert.equal(demoEntrarAlias("club"), "club");
  assert.equal(demoEntrarAlias("conserxaria"), "staff");
  assert.equal(demoEntrarAlias("deputacion"), "deputacion");
});

test("demo entrar: normaliza cidada/admin/staff aos perfís da ruta", () => {
  assert.equal(normalizeDemoEntrarPerfil("cidada"), "vecina");
  assert.equal(normalizeDemoEntrarPerfil("vecino"), "vecina");
  assert.equal(normalizeDemoEntrarPerfil("admin"), "concello");
  assert.equal(normalizeDemoEntrarPerfil("staff"), "conserxaria");
  assert.equal(normalizeDemoEntrarPerfil("conserxe"), "conserxaria");
  assert.equal(normalizeDemoEntrarPerfil("nope"), null);
});

test("demo entrar: relay e userKey por slug (como DemoProfileBar)", () => {
  assert.equal(demoEntrarRelay("secundario", "vecina"), "/c/secundario");
  assert.equal(demoEntrarUserKey("secundario", "vecina"), "cidada");
  assert.equal(demoEntrarUserKey("exemplo", "vecina"), "cidada");
  assert.equal(demoEntrarRelay("exemplo", "deputacion"), "/deputacion");
  assert.equal(demoEntrarUserKey("exemplo", "deputacion"), "deputacion");
});
