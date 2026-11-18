/**
 * Mock IdP «Elixe quen es»: contas agrupadas; RelayState Exemplo + Luis → Concello Secundario.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-idp-select-"));
const usersFile = path.join(tmp, "demo-users.json");

fs.writeFileSync(
  usersFile,
  JSON.stringify([
    {
      nif: "10000001S",
      nombre: "Veciña",
      apellidos: "Castro Lires",
      email: "vecina.exemplo@demo.test",
      role: "vecino",
      municipalitySlug: "exemplo",
    },
    {
      nif: "10000002Q",
      nombre: "Luis",
      apellidos: "Otero Boo",
      email: "vecino.secundario@demo.test",
      role: "vecino",
      municipalitySlug: "secundario",
    },
    {
      nif: "10000003V",
      nombre: "Marta",
      apellidos: "Rial Pazos",
      email: "admin.exemplo@demo.test",
      role: "admin",
      municipalitySlug: "exemplo",
    },
    {
      nif: "10000008E",
      nombre: "Miguel",
      apellidos: "Pereira",
      email: "club.exemplo@demo.test",
      role: "club",
      municipalitySlug: "exemplo",
      clubName: "Club Deportivo Exemplo",
    },
    {
      nif: "10000007K",
      nombre: "Iria",
      apellidos: "Souto",
      email: "deputacion@demo.test",
      role: "deputacion",
      municipalitySlug: null,
    },
  ]),
  "utf8",
);

process.env.DEMO_USERS_FILE = usersFile;
process.env.NODE_ENV = "test";

const { initDemoUsersFromEnv, getLoadedDemoFileUsers } = await import(
  "./demo-users-file.js"
);
const {
  renderMockIdpSelectHtml,
  personaDest,
  orderMuniGroups,
  muniHeaderTitle,
} = await import("./saml-idp-select-html.js");
const { toDemoFileSamlPersona } = await import("./demo-users-file.js");

describe("Mock IdP Elixe quen es (multi-concello)", () => {
  before(() => {
    initDemoUsersFromEnv();
  });

  after(() => {
    delete process.env.DEMO_USERS_FILE;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("RelayState Exemplo + Luis → /c/secundario (non o RelayState de Exemplo)", () => {
    const brais = getLoadedDemoFileUsers()!.find((u) =>
      u.displayName.includes("Luis"),
    );
    assert.ok(brais);
    const persona = toDemoFileSamlPersona(brais!);
    const dest = personaDest(persona, "/c/exemplo", true);
    assert.equal(dest, "/c/secundario");

    const html = renderMockIdpSelectHtml({
      relayState: "/c/exemplo",
      samlRequest: "",
    });
    assert.match(html, /Elixe quen es/);
    assert.match(html, /Luis Otero Boo/);
    /* Non cruzar </form>: un regex amplo collía o RelayState de Veciña. */
    const forms = [
      ...html.matchAll(
        /<form method="post" action="\/auth\/saml\/mock-idp\/sso">([\s\S]*?)<\/form>/g,
      ),
    ];
    const braisForm = forms.find((m) => m[1]!.includes("Luis Otero Boo"));
    assert.ok(braisForm, "formulario de Luis");
    const relay = braisForm![1]!.match(/name="RelayState" value="([^"]+)"/);
    assert.equal(relay?.[1], "/c/secundario");
  });

  it("HTML: grupo RelayState (Exemplo) primeiro, Deputación ao final, escudo+título", () => {
    const html = renderMockIdpSelectHtml({
      relayState: "/c/exemplo",
      samlRequest: "",
    });
    const exemploIdx = html.indexOf('data-muni="exemplo"');
    const portoIdx = html.indexOf('data-muni="secundario"');
    const depIdx = html.indexOf('data-muni="deputacion"');
    assert.ok(exemploIdx >= 0 && portoIdx >= 0 && depIdx >= 0);
    assert.ok(exemploIdx < portoIdx, "Exemplo (RelayState) antes de Concello Secundario");
    assert.ok(portoIdx < depIdx, "Deputación ao final");
    assert.match(html, /Concello de Exemplo/);
    assert.match(html, /Concello de Concello Secundario/);
    assert.match(html, /src="\/api\/c\/exemplo\/logo"/);
    assert.match(html, /width="28"/);
    assert.match(html, /class="persona-muni">Exemplo</);
    assert.match(html, /class="persona-muni">Concello Secundario</);
    assert.equal(html.includes('class="persona-muni">secundario<'), false);
    assert.match(html, /Veciña Castro Lires/);
  });

  it("orderMuniGroups e título", () => {
    assert.deepEqual(orderMuniGroups(["secundario", "exemplo"], "exemplo"), [
      "exemplo",
      "secundario",
      null,
    ]);
    assert.equal(muniHeaderTitle("secundario"), "Concello de Concello Secundario");
  });
});
