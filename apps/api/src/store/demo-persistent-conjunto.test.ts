import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

const API_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-conjunto-demo-"));
const pgliteDir = path.join(tmpRoot, "pglite");
const snapshotPath = path.join(tmpRoot, "data", "demo-snapshot");
const usersFilePath = path.join(tmpRoot, "demo-users-conjunto.json");

const CONJUNTO_USERS = [
  {
    nif: "00000011B",
    nombre: "Icía",
    apellidos: "Lago Varela",
    email: "vecina.vilaproba@conjunto.proba.org",
    role: "vecino",
    municipalitySlug: "vilaproba",
  },
  {
    nif: "00000012N",
    nombre: "Anxo",
    apellidos: "Castro Mato",
    email: "vecino.costanova@conjunto.proba.org",
    role: "vecino",
    municipalitySlug: "costanova",
  },
  {
    nif: "00000013J",
    nombre: " Tareixa",
    apellidos: "Pazos Souto",
    email: "admin.vilaproba@conjunto.proba.org",
    role: "admin",
    municipalitySlug: "vilaproba",
  },
  {
    nif: "00000014Z",
    nombre: "Lois",
    apellidos: "Rivas Boo",
    email: "admin.costanova@conjunto.proba.org",
    role: "admin",
    municipalitySlug: "costanova",
  },
  {
    nif: "00000015S",
    nombre: "Xiana",
    apellidos: "Míguez Rey",
    email: "conserxe.vilaproba@conjunto.proba.org",
    role: "conserxe",
    municipalitySlug: "vilaproba",
  },
  {
    nif: "00000016Q",
    nombre: "Martiño",
    apellidos: "Otero Lema",
    email: "conserxe.costanova@conjunto.proba.org",
    role: "conserxe",
    municipalitySlug: "costanova",
  },
  {
    nif: "00000017V",
    nombre: "Breixo",
    apellidos: "Ferreiro Calo",
    email: "club.vilaprobafs@conjunto.proba.org",
    role: "club",
    municipalitySlug: "vilaproba",
    clubName: "Vilaproba FS",
  },
  {
    nif: "00000018H",
    nombre: "Sía",
    apellidos: "Nogueira Paz",
    email: "deputacion@conjunto.proba.org",
    role: "deputacion",
    municipalitySlug: null,
  },
];

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("non se puido obter porto")));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHealth(baseUrl: string, proc: ChildProcess): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`API saíu prematuramente con código ${proc.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // Agardar a que o servidor escoite
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Timeout agardando /health da API");
}

async function stopProcess(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}

function parseIdpForms(html: string): Array<{
  userKey: string;
  relayState: string;
  name: string;
}> {
  const out: Array<{ userKey: string; relayState: string; name: string }> = [];
  const formRe =
    /<form method="post" action="\/auth\/saml\/mock-idp\/sso">([\s\S]*?)<\/form>/g;
  for (const match of html.matchAll(formRe)) {
    const block = match[1] ?? "";
    const userKey = block.match(/name="user"\s+value="([^"]+)"/)?.[1] ?? "";
    const relayState =
      block.match(/name="RelayState"\s+value="([^"]+)"/)?.[1] ?? "/";
    const name =
      block.match(/<span class="persona-name">([^<]+)<\/span>/)?.[1] ?? "";
    if (userKey) out.push({ userKey, relayState, name });
  }
  return out;
}

async function completeMockSamlLogin(
  baseUrl: string,
  userKey: string,
  relayState: string,
): Promise<{ status: number; location: string; cookie: string | null }> {
  const ssoBody = new URLSearchParams({ user: userKey, RelayState: relayState });
  const ssoRes = await fetch(`${baseUrl}/auth/saml/mock-idp/sso`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
    },
    body: ssoBody.toString(),
    redirect: "manual",
  });
  assert.equal(ssoRes.status, 200);
  const ssoHtml = await ssoRes.text();
  const samlResponse =
    ssoHtml.match(/name="SAMLResponse"\s+value="([^"]+)"/)?.[1] ?? "";
  assert.ok(samlResponse.length > 0, "Falta SAMLResponse no auto-post do IdP");

  const acsBody = new URLSearchParams({
    SAMLResponse: samlResponse,
    RelayState: relayState,
  });
  const acsRes = await fetch(`${baseUrl}/auth/saml/acs`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: acsBody.toString(),
    redirect: "manual",
  });
  const setCookie = acsRes.headers.get("set-cookie") ?? "";
  const cookieMatch = setCookie.match(/pa_sesion=[^;]+/);
  return {
    status: acsRes.status,
    location: acsRes.headers.get("location") ?? "",
    cookie: cookieMatch ? cookieMatch[0] : null,
  };
}

describe("Tests de conxunto: PA_DEMO_EMPTY=1 + DEMO_USERS_FILE + foto da demo", () => {
  let serverProc: ChildProcess | null = null;
  let baseUrl = "";

  before(async () => {
    fs.writeFileSync(usersFilePath, JSON.stringify(CONJUNTO_USERS, null, 2));
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    serverProc = spawn(
      process.execPath,
      ["--import", "tsx", "src/index.ts"],
      {
        cwd: API_DIR,
        env: {
          ...process.env,
          NODE_ENV: "demo",
          PA_DEMO: "1",
          PA_DEMO_EMPTY: "1",
          DEMO_USERS_FILE: usersFilePath,
          DEMO_SNAPSHOT_PATH: snapshotPath,
          PGLITE_DATA_DIR: pgliteDir,
          DATABASE_URL: "",
          API_HOST: "127.0.0.1",
          API_PORT: String(port),
          APP_BASE_URL: baseUrl,
          API_BASE_URL: baseUrl,
          SESSION_SECRET: "conjunto-demo-session-secret-32chars!!",
          SAML_SP_ENTITY_ID: `${baseUrl}/auth/saml/metadata`,
          SAML_CALLBACK_URL: `${baseUrl}/auth/saml/acs`,
          SAML_IDP_ENTITY_ID: `${baseUrl}/auth/saml/mock-idp`,
          SAML_IDP_SSO_URL: `${baseUrl}/auth/saml/mock-idp`,
          SAML_VALIDATE_IN_RESPONSE_TO: "never",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await waitForHealth(baseUrl, serverProc);
  });

  after(async () => {
    await stopProcess(serverProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("a API non arranca se DEMO_USERS_FILE apunta a un JSON inválido", async () => {
    const badPath = path.join(tmpRoot, "bad-users.json");
    fs.writeFileSync(badPath, JSON.stringify([{ nif: "malo" }]));
    const badPort = await getFreePort();
    const badPglite = path.join(tmpRoot, "bad-pglite");

    let stderr = "";
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/index.ts"],
        {
          cwd: API_DIR,
          env: {
            ...process.env,
            NODE_ENV: "demo",
            PA_DEMO: "1",
            PA_DEMO_EMPTY: "1",
            DEMO_USERS_FILE: badPath,
            PGLITE_DATA_DIR: badPglite,
            DATABASE_URL: "",
            API_HOST: "127.0.0.1",
            API_PORT: String(badPort),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("exit", (code) => resolve(code));
    });

    assert.notEqual(exitCode, 0);
    assert.match(stderr, /DEMO_USERS_FILE/);
  });

  it("arranca sen concellos da semente, lista as contas do ficheiro, avisa sen 500 e vincula o club", async () => {
    // 1) Non existe ningún concello da semente
    const munisRes = await fetch(`${baseUrl}/api/municipalities`);
    assert.equal(munisRes.status, 200);
    const munisBody = (await munisRes.json()) as { data: unknown[] };
    assert.deepEqual(munisBody.data, []);

    // 2) O mock-idp lista unicamente as 8 contas do ficheiro
    const idpRes = await fetch(`${baseUrl}/auth/saml/mock-idp`);
    assert.equal(idpRes.status, 200);
    const idpHtml = await idpRes.text();
    const forms = parseIdpForms(idpHtml);
    assert.equal(forms.length, 8);
    assert.doesNotMatch(idpHtml, /Ana Demo/);
    for (const acc of CONJUNTO_USERS) {
      const expectedName = `${acc.nombre.trim()} ${acc.apellidos.trim()}`;
      assert.ok(
        forms.some((f) => f.name === expectedName),
        `Falta ${expectedName} na listaxe do mock-idp`,
      );
    }

    // 3) Unha conta cun slug que aínda non existe dá o aviso e nunca un 500
    const missingSlugForm = forms.find((f) => f.name === "Anxo Castro Mato")!;
    const missingLogin = await completeMockSamlLogin(
      baseUrl,
      missingSlugForm.userKey,
      missingSlugForm.relayState,
    );
    assert.notEqual(missingLogin.status, 500);
    assert.equal(missingLogin.status, 302);
    assert.match(missingLogin.location, /\/acceso\?erro=concello_non_creado/);
    assert.equal(missingLogin.cookie, null);

    // 4) Superadmin entra e crea o concello ficticio 'vilaproba'
    const depForm = forms.find((f) => f.name === "Sía Nogueira Paz")!;
    const depLogin = await completeMockSamlLogin(
      baseUrl,
      depForm.userKey,
      depForm.relayState,
    );
    assert.equal(depLogin.status, 302);
    assert.ok(depLogin.cookie);

    const createMuniRes = await fetch(`${baseUrl}/api/municipalities`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: depLogin.cookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        name: "Concello de Vilaproba",
        slug: "vilaproba",
        accentColor: "#1D5B79",
      }),
    });
    assert.equal(createMuniRes.status, 201);

    // 5) Conta club cando o club aínda non existe -> entra como veciño con aviso
    const clubForm = forms.find((f) => f.name === "Breixo Ferreiro Calo")!;
    const clubBefore = await completeMockSamlLogin(
      baseUrl,
      clubForm.userKey,
      clubForm.relayState,
    );
    assert.equal(clubBefore.status, 302);
    assert.ok(clubBefore.cookie);
    assert.match(clubBefore.location, /\/c\/vilaproba\?/);
    assert.match(clubBefore.location, /aviso=club_non_creado/);

    const meBeforeRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: clubBefore.cookie },
    });
    const meBefore = (await meBeforeRes.json()) as {
      user: { role: string; municipalitySlug: string };
    };
    assert.equal(meBefore.user.role, "citizen");
    assert.equal(meBefore.user.municipalitySlug, "vilaproba");

    // 6) Admin de vilaproba entra e crea o club 'Vilaproba FS'
    const adminForm = forms.find((f) => f.name === "Tareixa Pazos Souto")!;
    const adminLogin = await completeMockSamlLogin(
      baseUrl,
      adminForm.userKey,
      adminForm.relayState,
    );
    assert.equal(adminLogin.status, 302);
    assert.ok(adminLogin.cookie);

    const createClubRes = await fetch(
      `${baseUrl}/api/c/vilaproba/admin/clubs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminLogin.cookie,
          Origin: baseUrl,
        },
        body: JSON.stringify({
          name: "Vilaproba FS",
          shortName: "Vilaproba FS",
          accountEmail: "entidade.vilaprobafs@conjunto.proba.org",
        }),
      },
    );
    assert.equal(createClubRes.status, 201);
    const createdClub = (await createClubRes.json()) as {
      data: { id: string; name: string };
    };

    // 7) Conta club entra agora que o club existe -> queda vinculada ao club
    const clubAfter = await completeMockSamlLogin(
      baseUrl,
      clubForm.userKey,
      clubForm.relayState,
    );
    assert.equal(clubAfter.status, 302);
    assert.ok(clubAfter.cookie);
    assert.doesNotMatch(clubAfter.location, /aviso=club_non_creado/);
    assert.match(
      clubAfter.location,
      new RegExp(`/c/vilaproba/clubs/${createdClub.data.id}`),
    );

    const meAfterRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: clubAfter.cookie },
    });
    const meAfter = (await meAfterRes.json()) as {
      user: {
        id: string;
        role: string;
        clubId: string;
        linkedClubs: Array<{ id: string }>;
      };
    };
    assert.equal(meAfter.user.role, "club_manager");
    assert.equal(meAfter.user.clubId, createdClub.data.id);
    assert.equal(meAfter.user.linkedClubs.length, 1);

    const respListRes = await fetch(
      `${baseUrl}/api/c/vilaproba/admin/clubs/${createdClub.data.id}/responsables`,
      {
        headers: { Cookie: adminLogin.cookie },
      },
    );
    assert.equal(respListRes.status, 200);
    const respList = (await respListRes.json()) as {
      data: Array<{ userId: string }>;
    };
    assert.equal(
      respList.data.some((r) => r.userId === meAfter.user.id),
      true,
    );

    // 8) Gardar foto da demo e comprobar que reset conserva vilaproba + club
    const snapRes = await fetch(`${baseUrl}/api/demo/snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: depLogin.cookie,
        Origin: baseUrl,
      },
      body: "{}",
    });
    assert.equal(snapRes.status, 200);
    assert.equal(fs.existsSync(snapshotPath), true);

    const extraMuniRes = await fetch(`${baseUrl}/api/municipalities`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: depLogin.cookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        name: "Concello Temporal",
        slug: "temporal",
        accentColor: "#333333",
      }),
    });
    assert.equal(extraMuniRes.status, 201);

    const resetRes = await fetch(`${baseUrl}/api/demo/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: depLogin.cookie,
        Origin: baseUrl,
      },
      body: "{}",
    });
    assert.equal(resetRes.status, 200);

    const checkTemporal = await fetch(`${baseUrl}/api/c/temporal/info`);
    assert.equal(checkTemporal.status, 404);
    const checkVilaproba = await fetch(`${baseUrl}/api/c/vilaproba/info`);
    assert.equal(checkVilaproba.status, 200);
  });
});
