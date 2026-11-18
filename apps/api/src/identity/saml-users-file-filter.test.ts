/**
 * DEMO_USERS_FILE: resolveDemoUser usa o concello do RelayState nos alias;
 * o IdP lista TODAS as contas (agrupadas no HTML).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-saml-file-filter-"));
const usersFile = path.join(tmp, "demo-users.json");

fs.writeFileSync(
  usersFile,
  JSON.stringify([
    {
      nif: "10000001S",
      nombre: "Veciña",
      apellidos: "Exemplo",
      email: "u.exemplo@demo.test",
      role: "vecino",
      municipalitySlug: "exemplo",
    },
    {
      nif: "10000002Q",
      nombre: "Luis",
      apellidos: "Son",
      email: "b.son@demo.test",
      role: "vecino",
      municipalitySlug: "secundario",
    },
    {
      nif: "10000003V",
      nombre: "Marta",
      apellidos: "AdminExemplo",
      email: "a.exemplo@demo.test",
      role: "admin",
      municipalitySlug: "exemplo",
    },
    {
      nif: "10000004H",
      nombre: "Pedro",
      apellidos: "AdminSon",
      email: "a.son@demo.test",
      role: "admin",
      municipalitySlug: "secundario",
    },
    {
      nif: "10000007K",
      nombre: "Iria",
      apellidos: "Dep",
      email: "dep@demo.test",
      role: "deputacion",
      municipalitySlug: null,
    },
  ]),
  "utf8",
);

process.env.DEMO_USERS_FILE = usersFile;
process.env.NODE_ENV = "test";

const { initDemoUsersFromEnv } = await import("./demo-users-file.js");
const { demoUsersForSlug, resolveDemoUser } = await import("./saml-users.js");

describe("DEMO_USERS_FILE: alias por RelayState + listaxe completa", () => {
  before(() => {
    initDemoUsersFromEnv();
  });

  after(() => {
    delete process.env.DEMO_USERS_FILE;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("demoUsersForSlug lista TODAS as contas do ficheiro", () => {
    const keys = demoUsersForSlug("secundario").map((u) => u.displayName);
    assert.ok(keys.some((n) => n.includes("Luis")));
    assert.ok(keys.some((n) => n.includes("Pedro")));
    assert.ok(keys.some((n) => n.includes("Iria")));
    assert.ok(keys.some((n) => n.includes("Veciña")));
    assert.ok(keys.some((n) => n.includes("Marta")));
  });

  it("resolveDemoUser(cidada, /c/secundario) → veciño de Concello Secundario", () => {
    const u = resolveDemoUser("cidada", "/c/secundario");
    assert.equal(u.municipalitySlug, "secundario");
    assert.match(u.displayName, /Luis/);
  });

  it("resolveDemoUser sen match non cae no primeiro (Exemplo)", () => {
    assert.throws(
      () => resolveDemoUser("club", "/c/secundario"),
      /demo_user_not_found/,
    );
  });
});
