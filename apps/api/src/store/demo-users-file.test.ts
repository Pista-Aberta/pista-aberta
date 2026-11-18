import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { resolvePostLoginPath } from "@pista-aberta/shared";
import { closeDb, getDb, initDb } from "../db/client.js";
import { migrateSchema } from "../db/migrate.js";
import * as t from "../db/schema.js";
import { seedEmptyDemoDb } from "../db/seed-db.js";
import {
  initDemoUsersFromEnv,
  parseDemoUsersJson,
} from "../identity/demo-users-file.js";
import { DemoMunicipalityNotCreatedError } from "../identity/demo-users-provision.js";
import { withLoginParam } from "../identity/login-rate-limit.js";
import { buildSignedAuthnResponse } from "../identity/saml-idp.js";
import {
  resetSamlSpForTests,
  validateAcsPost,
} from "../identity/saml-sp.js";
import { setSessionCookie } from "../identity/session-cookie.js";
import {
  createSession,
  getSessionMeta,
  resolveUserSlug,
  setSessionActiveClub,
  setSessionActiveMuniRole,
} from "../identity/sessions.js";
import { registerMockIdpRoutes } from "../routes/public-portal-routes.js";
import { listClubResponsables } from "./club-members.js";
import { createMunicipality } from "./db.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-demo-users-"));
const pgliteDir = path.join(tmpRoot, "pglite");
const usersJsonPath = path.join(tmpRoot, "demo-users-test.json");

const FICTITIOUS_ACCOUNTS = [
  {
    nif: "00000001R",
    nombre: "Navia",
    apellidos: "Castro Lema",
    email: "vecina.vilaproba@proba.proba.org",
    role: "vecino",
    municipalitySlug: "vilaproba",
  },
  {
    nif: "00000002W",
    nombre: "Roi",
    apellidos: "Vidal Souto",
    email: "admin.vilaproba@proba.proba.org",
    role: "admin",
    municipalitySlug: "vilaproba",
  },
  {
    nif: "00000003A",
    nombre: "Sara",
    apellidos: "Pazos Rey",
    email: "conserxe.vilaproba@proba.proba.org",
    role: "conserxe",
    municipalitySlug: "vilaproba",
  },
  {
    nif: "00000004G",
    nombre: "Bieito",
    apellidos: "Rivas Mato",
    email: "club.vilaproba@proba.proba.org",
    role: "club",
    municipalitySlug: "vilaproba",
    clubName: "Vilaproba FS",
  },
  {
    nif: "00000005M",
    nombre: "Celtia",
    apellidos: "Ferreiro Lago",
    email: "vecina.montefaro@proba.proba.org",
    role: "vecino",
    municipalitySlug: "montefaro",
  },
  {
    nif: "00000006Y",
    nombre: "Aldara",
    apellidos: "Míguez Boo",
    email: "deputacion@proba.proba.org",
    role: "deputacion",
    municipalitySlug: null,
  },
];

function buildTestAuthApp(appBase = "http://localhost:3000"): Hono {
  const app = new Hono();
  registerMockIdpRoutes(app);

  app.post("/auth/saml/acs", async (c) => {
    try {
      const body = await c.req.parseBody();
      const { user, relayState, warning, activateClubId, activateMuniRole } =
        await validateAcsPost({
          SAMLResponse: String(body.SAMLResponse ?? ""),
          RelayState: String(body.RelayState ?? "/"),
        });
      const sessionId = await createSession(user, { authMethod: "saml" });
      if (activateClubId) {
        await setSessionActiveClub(sessionId, activateClubId);
      } else if (activateMuniRole) {
        await setSessionActiveMuniRole(
          sessionId,
          activateMuniRole.role,
          activateMuniRole.municipalityId,
        );
      }
      setSessionCookie(c, sessionId);
      const userSlug = await resolveUserSlug(user);
      const normalizedRelay =
        relayState === "/" ||
        (user.role === "club_manager" &&
          user.clubId &&
          relayState === `/c/${userSlug}/clubs`)
          ? undefined
          : relayState;
      const dest = resolvePostLoginPath(
        user.role,
        userSlug,
        normalizedRelay,
        user.clubId,
      );
      let redirectUrl = withLoginParam(appBase, dest, "saml");
      if (warning === "club_non_creado") {
        const parsedUrl = new URL(redirectUrl);
        parsedUrl.searchParams.set("aviso", "club_non_creado");
        redirectUrl = parsedUrl.toString();
      }
      return c.redirect(redirectUrl);
    } catch (e) {
      if (e instanceof DemoMunicipalityNotCreatedError) {
        return c.redirect(`${appBase}/acceso?erro=concello_non_creado`);
      }
      return c.json({ error: "internal" }, 500);
    }
  });

  app.get("/auth/me", async (c) => {
    const sid = getCookie(c, "pa_sesion");
    if (!sid) return c.json({ user: null });
    const meta = await getSessionMeta(sid);
    return c.json({ user: meta?.user ?? null });
  });

  return app;
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/pa_sesion=[^;]+/);
  assert.ok(match, `Falta cookie pa_sesion en: ${setCookie}`);
  return match[0];
}

async function samlLoginByKey(app: Hono, userKey: string, relayState = "/") {
  const { base64 } = buildSignedAuthnResponse({ userKey, relayState });
  const form = new URLSearchParams();
  form.set("SAMLResponse", base64);
  form.set("RelayState", relayState);
  return app.request("/auth/saml/acs", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

describe("DEMO_USERS_FILE: validación Zod, mock-idp, roles e avisos", () => {
  const prevDemo = process.env.PA_DEMO;
  const prevEmpty = process.env.PA_DEMO_EMPTY;
  const prevUsersFile = process.env.DEMO_USERS_FILE;
  const prevPglite = process.env.PGLITE_DATA_DIR;
  const prevDbUrl = process.env.DATABASE_URL;

  before(async () => {
    process.env.PGLITE_DATA_DIR = pgliteDir;
    process.env.PA_DEMO = "1";
    process.env.PA_DEMO_EMPTY = "1";
    process.env.NODE_ENV = "test";
    delete process.env.DATABASE_URL;
    delete process.env.DEMO_USERS_FILE;
    resetSamlSpForTests();
    await initDb();
    await migrateSchema();
  });

  after(async () => {
    await closeDb();
    resetSamlSpForTests();
    if (prevDemo === undefined) delete process.env.PA_DEMO;
    else process.env.PA_DEMO = prevDemo;
    if (prevEmpty === undefined) delete process.env.PA_DEMO_EMPTY;
    else process.env.PA_DEMO_EMPTY = prevEmpty;
    if (prevUsersFile === undefined) delete process.env.DEMO_USERS_FILE;
    else process.env.DEMO_USERS_FILE = prevUsersFile;
    if (prevPglite === undefined) delete process.env.PGLITE_DATA_DIR;
    else process.env.PGLITE_DATA_DIR = prevPglite;
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDbUrl;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("valida o esquema Zod e bloquea o arranque se o ficheiro falta ou é inválido", () => {
    const parsed = parseDemoUsersJson(JSON.stringify(FICTITIOUS_ACCOUNTS));
    assert.equal(parsed.length, 6);

    // Ficheiro inexistente -> lanza erro claro
    process.env.DEMO_USERS_FILE = path.join(tmpRoot, "non-existe.json");
    assert.throws(() => initDemoUsersFromEnv(), /non existe/);

    // club sen clubName -> lanza erro
    assert.throws(
      () =>
        parseDemoUsersJson(
          JSON.stringify([
            {
              nif: "00000004G",
              nombre: "Bieito",
              apellidos: "Rivas",
              email: "club@proba.proba.org",
              role: "club",
              municipalitySlug: "vilaproba",
            },
          ]),
        ),
      /clubName/,
    );

    // vecino con clubName -> lanza erro
    assert.throws(
      () =>
        parseDemoUsersJson(
          JSON.stringify([
            {
              nif: "00000001R",
              nombre: "Navia",
              apellidos: "Castro",
              email: "vecina@proba.proba.org",
              role: "vecino",
              municipalitySlug: "vilaproba",
              clubName: "Club Sobrante",
            },
          ]),
        ),
      /clubName/,
    );

    // deputacion con municipalitySlug distinto de null -> lanza erro
    assert.throws(
      () =>
        parseDemoUsersJson(
          JSON.stringify([
            {
              nif: "00000006Y",
              nombre: "Aldara",
              apellidos: "Míguez",
              email: "dep@proba.proba.org",
              role: "deputacion",
              municipalitySlug: "vilaproba",
            },
          ]),
        ),
      /municipalitySlug/,
    );

    // admin con municipalitySlug null -> lanza erro
    assert.throws(
      () =>
        parseDemoUsersJson(
          JSON.stringify([
            {
              nif: "00000002W",
              nombre: "Roi",
              apellidos: "Vidal",
              email: "admin@proba.proba.org",
              role: "admin",
              municipalitySlug: null,
            },
          ]),
        ),
      /municipalitySlug/,
    );

    // NIF con letra incorrecta -> lanza erro
    assert.throws(
      () =>
        parseDemoUsersJson(
          JSON.stringify([
            {
              nif: "00000001Z",
              nombre: "Navia",
              apellidos: "Castro",
              email: "vecina@proba.proba.org",
              role: "vecino",
              municipalitySlug: "vilaproba",
            },
          ]),
        ),
      /NIF/,
    );

    delete process.env.DEMO_USERS_FILE;
    assert.equal(initDemoUsersFromEnv(), null);
  });

  it("sen DEMO_USERS_FILE o mock-idp usa as contas habituais da semente", async () => {
    delete process.env.DEMO_USERS_FILE;
    initDemoUsersFromEnv();
    const app = buildTestAuthApp();
    const res = await app.request("/auth/saml/mock-idp");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Ana Demo/);
  });

  it("con DEMO_USERS_FILE mostra só esas contas, avisa sen 500 se falta concello e vincula roles + club", async () => {
    fs.writeFileSync(usersJsonPath, JSON.stringify(FICTITIOUS_ACCOUNTS, null, 2));
    process.env.DEMO_USERS_FILE = usersJsonPath;
    const loaded = initDemoUsersFromEnv()!;
    assert.equal(loaded.length, 6);

    await seedEmptyDemoDb();
    await createMunicipality({
      name: "Concello de Vilaproba",
      slug: "vilaproba",
      accentColor: "#1B5E7A",
      sandbox: false,
    });

    const app = buildTestAuthApp();

    // 1. mock-idp mostra só as 6 contas do ficheiro
    const idpRes = await app.request("/auth/saml/mock-idp");
    assert.equal(idpRes.status, 200);
    const idpHtml = await idpRes.text();
    assert.doesNotMatch(idpHtml, /Ana Demo/);
    for (const acc of FICTITIOUS_ACCOUNTS) {
      assert.ok(
        idpHtml.includes(`${acc.nombre} ${acc.apellidos}`),
        `Falta ${acc.nombre} no mock-idp`,
      );
    }

    // 2. Concello inexistente (montefaro) -> 302 con erro=concello_non_creado, nunca 500
    const missingMuniKey = loaded.find((u) => u.municipalitySlug === "montefaro")!.key;
    const missingRes = await samlLoginByKey(app, missingMuniKey);
    assert.equal(missingRes.status, 302);
    assert.match(
      missingRes.headers.get("location") ?? "",
      /\/acceso\?erro=concello_non_creado/,
    );

    // 3. Deputación -> superadmin
    const depKey = loaded.find((u) => u.role === "deputacion")!.key;
    const depRes = await samlLoginByKey(app, depKey);
    assert.equal(depRes.status, 302);
    assert.match(depRes.headers.get("location") ?? "", /\/deputacion\?login=saml/);
    const depMe = await (
      await app.request("/auth/me", {
        headers: { Cookie: extractSessionCookie(depRes) },
      })
    ).json() as { user: { role: string } };
    assert.equal(depMe.user.role, "superadmin");

    // 4. Admin e conserxe en vilaproba
    const adminKey = loaded.find((u) => u.role === "admin")!.key;
    const adminRes = await samlLoginByKey(app, adminKey, "/c/vilaproba/admin");
    assert.equal(adminRes.status, 302);
    const adminMe = await (
      await app.request("/auth/me", {
        headers: { Cookie: extractSessionCookie(adminRes) },
      })
    ).json() as { user: { role: string; municipalitySlug: string } };
    assert.equal(adminMe.user.role, "admin");
    assert.equal(adminMe.user.municipalitySlug, "vilaproba");

    const staffKey = loaded.find((u) => u.role === "conserxe")!.key;
    const staffRes = await samlLoginByKey(
      app,
      staffKey,
      "/c/vilaproba/conserxeria",
    );
    assert.equal(staffRes.status, 302);
    const staffMe = await (
      await app.request("/auth/me", {
        headers: { Cookie: extractSessionCookie(staffRes) },
      })
    ).json() as { user: { role: string; municipalitySlug: string } };
    assert.equal(staffMe.user.role, "staff");
    assert.equal(staffMe.user.municipalitySlug, "vilaproba");

    // 5. Conta club antes de crear o club -> entra como veciño con aviso=club_non_creado
    const clubKey = loaded.find((u) => u.role === "club")!.key;
    const clubBeforeRes = await samlLoginByKey(app, clubKey, "/c/vilaproba");
    assert.equal(clubBeforeRes.status, 302);
    assert.match(
      clubBeforeRes.headers.get("location") ?? "",
      /aviso=club_non_creado/,
    );
    const clubBeforeMe = await (
      await app.request("/auth/me", {
        headers: { Cookie: extractSessionCookie(clubBeforeRes) },
      })
    ).json() as { user: { role: string; municipalitySlug: string } };
    assert.equal(clubBeforeMe.user.role, "citizen");
    assert.equal(clubBeforeMe.user.municipalitySlug, "vilaproba");

    // 6. Crear o club (con maiúsculas e til distintas) -> vincula con addClubResponsable
    await getDb().insert(t.clubs).values({
      id: "club-vilaproba-fs",
      municipalityId: "muni-vilaproba",
      name: "Agrupación Deportiva Vilapróba",
      shortName: "vilapróba fs",
      sport: "futbol_sala",
    });

    const clubAfterRes = await samlLoginByKey(app, clubKey);
    assert.equal(clubAfterRes.status, 302);
    assert.doesNotMatch(
      clubAfterRes.headers.get("location") ?? "",
      /aviso=club_non_creado/,
    );
    assert.match(
      clubAfterRes.headers.get("location") ?? "",
      /\/c\/vilaproba\/clubs\/club-vilaproba-fs/,
    );
    const clubAfterMe = await (
      await app.request("/auth/me", {
        headers: { Cookie: extractSessionCookie(clubAfterRes) },
      })
    ).json() as {
      user: {
        id: string;
        role: string;
        clubId: string;
        linkedClubs: Array<{ id: string }>;
      };
    };
    assert.equal(clubAfterMe.user.role, "club_manager");
    assert.equal(clubAfterMe.user.clubId, "club-vilaproba-fs");
    assert.equal(clubAfterMe.user.linkedClubs.length, 1);

    const responsables = await listClubResponsables(
      "club-vilaproba-fs",
      "muni-vilaproba",
    );
    assert.equal(responsables.length, 1);
    assert.equal(responsables[0]?.userId, clubAfterMe.user.id);

    // Segundo login da mesma conta club -> idempotente (non duplica responsable)
    const clubSecondRes = await samlLoginByKey(app, clubKey);
    assert.equal(clubSecondRes.status, 302);
    const responsablesAfterSecond = await listClubResponsables(
      "club-vilaproba-fs",
      "muni-vilaproba",
    );
    assert.equal(responsablesAfterSecond.length, 1);
  });
});
