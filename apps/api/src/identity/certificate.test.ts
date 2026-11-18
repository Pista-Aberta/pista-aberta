/**
 * Tests certificado dixital: parseClientCert + rotas callback/finish.
 * Fixtures xerados en memoria (AC demo); sen claves no git.
 */
import "reflect-metadata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as x509 from "@peculiar/x509";
import { Crypto } from "@peculiar/webcrypto";
import { Hono } from "hono";

const crypto = new Crypto();
x509.cryptoProvider.set(crypto);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pa-cert-"));
process.env.PGLITE_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.PA_DEMO = "1";
process.env.CERT_LOGIN_ENABLED = "1";
process.env.CERT_GATEWAY_SECRET = "test-cert-gateway-secret-32chars!!";
process.env.CERT_ORIGIN = "https://cert.example.test";
process.env.APP_BASE_URL = "https://demo.example.test";

const { initDb, closeDb } = await import("../db/client.js");
const { migrateSchema } = await import("../db/migrate.js");
const { seedDb } = await import("../db/seed-db.js");
const {
  parseClientCert,
  CertParseError,
  normalizeNif,
  validateNifLetter,
  DEMO_CA_CN,
} = await import("./certificate.js");
const { certificateRoutes, startCertificateLogin } = await import(
  "./certificate-routes.js"
);
const { getDb } = await import("../db/client.js");
const t = await import("../db/schema.js");
const { eq } = await import("drizzle-orm");

const alg: RsaHashedKeyGenParams = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};

async function issueClient(opts: {
  /** DN RFC4514; usar OIDs numéricos para attrs non estándar (p.ex. 2.5.4.97). */
  subject: string;
  notBefore?: Date;
  notAfter?: Date;
  /** false = sen digitalSignature (só keyEncipherment) */
  digitalSignature?: boolean;
}): Promise<string> {
  const caKeys = (await crypto.subtle.generateKey(alg, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const caCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=${DEMO_CA_CN},O=Pista Aberta probas,C=ES`,
    notBefore: new Date(Date.now() - 86400000),
    notAfter: new Date(Date.now() + 86400000 * 365),
    signingAlgorithm: alg,
    keys: caKeys,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  const keys = (await crypto.subtle.generateKey(alg, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const ku =
    opts.digitalSignature === false
      ? x509.KeyUsageFlags.keyEncipherment
      : x509.KeyUsageFlags.digitalSignature;

  const extensions: x509.Extension[] = [
    new x509.BasicConstraintsExtension(false, undefined, true),
    new x509.KeyUsagesExtension(ku, true),
    new x509.ExtendedKeyUsageExtension(
      [x509.ExtendedKeyUsage.clientAuth],
      false,
    ),
  ];

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: "1A2B",
    subject: opts.subject,
    issuer: caCert.subjectName,
    notBefore: opts.notBefore ?? new Date(Date.now() - 3600000),
    notAfter: opts.notAfter ?? new Date(Date.now() + 86400000 * 30),
    signingAlgorithm: alg,
    publicKey: keys.publicKey,
    signingKey: caKeys.privateKey,
    extensions,
  });
  return cert.toString("pem");
}

describe("toProperName", () => {
  it("converte maiúsculas do DN a nome propio", async () => {
    const { toProperName } = await import("./certificate.js");
    assert.equal(toProperName("PABLO LOPEZ NUÑEZ"), "Pablo Lopez Nuñez");
    assert.equal(toProperName("Ana Demo"), "Ana Demo");
  });
});

describe("parseClientCert + NIF", () => {
  it("normaliza IDCES- e valida letra", () => {
    assert.equal(normalizeNif("IDCES-88888888Y"), "88888888Y");
    assert.equal(normalizeNif("idces88888888Y"), "88888888Y");
    assert.ok(validateNifLetter("88888888Y"));
    assert.ok(!validateNifLetter("88888888A"));
    assert.ok(validateNifLetter("X1234567L"));
  });

  it("1. FNMT-like con IDCES-88888888Y", async () => {
    const pem = await issueClient({
      subject:
        "CN=Ana Demo - 88888888Y,2.5.4.5=IDCES-88888888Y,2.5.4.42=Ana,SN=Riveira,C=ES",
    });
    const id = parseClientCert(pem);
    assert.equal(id.nif, "88888888Y");
    assert.equal(id.personIdentifier, "ES/ES/88888888Y");
    assert.equal(id.givenName, "Ana");
    assert.ok(id.issuerCN.includes("DEMO CA"));
  });

  it("2. formato antigo sen prefixo", async () => {
    const pem = await issueClient({
      subject: "CN=Ana,2.5.4.5=88888888Y,2.5.4.42=Ana,SN=Riveira,C=ES",
    });
    assert.equal(parseClientCert(pem).nif, "88888888Y");
  });

  it("3. NIE X1234567L", async () => {
    const pem = await issueClient({
      subject: "CN=Nie,2.5.4.5=IDCES-X1234567L,2.5.4.42=Nie,SN=Test,C=ES",
    });
    assert.equal(parseClientCert(pem).nif, "X1234567L");
  });

  it("4. letra incorrecta → cert_sen_nif", async () => {
    const pem = await issueClient({
      subject: "CN=Bad,2.5.4.5=IDCES-88888888A,2.5.4.42=Bad,SN=Letter,C=ES",
    });
    assert.throws(() => parseClientCert(pem), (e: unknown) => {
      assert.ok(e instanceof CertParseError);
      assert.equal(e.code, "cert_sen_nif");
      return true;
    });
  });

  it("5. certificado caducado", async () => {
    const pem = await issueClient({
      subject: "CN=Old,2.5.4.5=IDCES-88888888Y,2.5.4.42=Old,SN=Cert,C=ES",
      notBefore: new Date("2020-01-01"),
      notAfter: new Date("2020-12-31"),
    });
    assert.throws(() => parseClientCert(pem), (e: unknown) => {
      assert.ok(e instanceof CertParseError);
      assert.equal(e.code, "cert_caducado");
      return true;
    });
  });

  it("6. representante VATES-B15000000", async () => {
    const pem = await issueClient({
      subject:
        "CN=Rep,2.5.4.5=IDCES-11111111H,2.5.4.42=Rep,SN=Club,2.5.4.97=VATES-B15000000,O=Club Demo,C=ES",
    });
    const id = parseClientCert(pem);
    assert.equal(id.representative?.cif, "B15000000");
    assert.equal(id.nif, "11111111H");
  });

  it("7. sen digitalSignature → erro", async () => {
    const pem = await issueClient({
      subject: "CN=NoKU,2.5.4.5=IDCES-88888888Y,2.5.4.42=No,SN=Ku,C=ES",
      digitalSignature: false,
    });
    assert.throws(() => parseClientCert(pem), /cert_ku|digitalSignature/);
  });
});

describe("rotas /auth/cert (integración)", () => {
  let app: Hono;
  let goodPem: string;

  before(async () => {
    await initDb();
    await migrateSchema();
    await seedDb();
    app = new Hono();
    app.route("/", certificateRoutes());
    goodPem = await issueClient({
      subject:
        "CN=Ana Demo,2.5.4.5=IDCES-88888888Y,2.5.4.42=Ana,SN=Riveira,C=ES",
    });
  });

  after(async () => {
    await closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("8. callback sen X-PA-Gateway-Auth → 401", async () => {
    const res = await app.request("/auth/cert/callback?state=x");
    assert.equal(res.status, 401);
  });

  it("9. callback con segredo incorrecto → 401", async () => {
    const res = await app.request("/auth/cert/callback?state=x", {
      headers: {
        "X-PA-Gateway-Auth": "wrong-secret-completely-different!!",
        "X-PA-Cert-Verify": "SUCCESS",
      },
    });
    assert.equal(res.status, 401);
  });

  it("10. X-PA-Cert-Verify FAILED → 401", async () => {
    const res = await app.request("/auth/cert/callback?state=x", {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "FAILED:certificate revoked",
      },
    });
    assert.equal(res.status, 401);
  });

  it("11. state reutilizado ou caducado → 400", async () => {
    const res = await app.request("/auth/cert/callback?state=nonexistent", {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "SUCCESS",
        "X-PA-Cert": encodeURIComponent(goodPem),
      },
    });
    assert.equal(res.status, 400);
  });

  it("12–14. ticket un uso + cidadán novo; admin existente mantén rol", async () => {
    const { redirectUrl } = await startCertificateLogin({
      municipalityId: "muni-exemplo",
      returnTo: "/c/exemplo",
    });
    const state = new URL(redirectUrl).searchParams.get("state")!;
    const res = await app.request(`/auth/cert/callback?state=${state}`, {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "SUCCESS",
        "X-PA-Cert": encodeURIComponent(goodPem),
      },
      redirect: "manual",
    });
    assert.equal(res.status, 302);
    const loc = res.headers.get("location") ?? "";
    assert.match(loc, /\/auth\/cert\/finish\?ticket=/);
    const ticket = new URL(loc).searchParams.get("ticket")!;

    const finish1 = await app.request(`/auth/cert/finish?ticket=${ticket}`, {
      redirect: "manual",
      headers: { Cookie: `pa_cert_state=${state}` },
    });
    assert.equal(finish1.status, 302);
    assert.ok(finish1.headers.get("set-cookie")?.includes("pa_sesion"));

    const finish2 = await app.request(`/auth/cert/finish?ticket=${ticket}`, {
      redirect: "manual",
      headers: { Cookie: `pa_cert_state=${state}` },
    });
    assert.equal(finish2.status, 302);
    assert.match(finish2.headers.get("location") ?? "", /motivo=ticket/);

    const users = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/88888888Y"))
      .limit(1);
    assert.equal(users[0]?.role, "citizen");
  });

  it("ticket: 5 finish simultáneos → só unha sesión", async () => {
    // 88888888 % 23 = 6 → Y
    const pem = await issueClient({
      subject:
        "CN=Race User,2.5.4.5=IDCES-88888888Y,2.5.4.42=Race,SN=User,C=ES",
    });
    const { redirectUrl } = await startCertificateLogin({
      municipalityId: "muni-exemplo",
    });
    const state = new URL(redirectUrl).searchParams.get("state")!;
    const cb = await app.request(`/auth/cert/callback?state=${state}`, {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "SUCCESS",
        "X-PA-Cert": encodeURIComponent(pem),
      },
      redirect: "manual",
    });
    assert.equal(cb.status, 302, await cb.text());
    const ticket = new URL(cb.headers.get("location")!).searchParams.get(
      "ticket",
    )!;
    assert.ok(ticket);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.request(`/auth/cert/finish?ticket=${ticket}`, {
          redirect: "manual",
          headers: { Cookie: `pa_cert_state=${state}` },
        }),
      ),
    );
    const withSession = results.filter((r) =>
      (r.headers.get("set-cookie") ?? "").includes("pa_sesion"),
    );
    const failed = results.filter(
      (r) => !(r.headers.get("set-cookie") ?? "").includes("pa_sesion"),
    );
    assert.equal(withSession.length, 1);
    assert.equal(failed.length, 4);
  });

  it("18. returnTo externo ignorado (resolvePostLoginPath)", async () => {
    const adminPem = await issueClient({
      subject:
        "CN=Admin Demo,2.5.4.5=IDCES-11223344B,2.5.4.42=Admin,SN=Admin,C=ES",
    });
    const { redirectUrl } = await startCertificateLogin({
      municipalityId: "muni-exemplo",
      returnTo: "https://evil.example",
    });
    const state = new URL(redirectUrl).searchParams.get("state")!;
    const res = await app.request(`/auth/cert/callback?state=${state}`, {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "SUCCESS",
        "X-PA-Cert": encodeURIComponent(adminPem),
      },
      redirect: "manual",
    });
    const ticket = new URL(res.headers.get("location")!).searchParams.get(
      "ticket",
    )!;
    const finish = await app.request(`/auth/cert/finish?ticket=${ticket}`, {
      redirect: "manual",
      headers: { Cookie: `pa_cert_state=${state}` },
    });
    const dest = finish.headers.get("location") ?? "";
    assert.ok(!dest.includes("evil.example"));
    assert.match(dest, /^\/c\/exemplo/);
  });

  it("cidadán existente: login cert noutro concello move a casa", async () => {
    // 12345678 % 23 = 14 → Z
    const pem = await issueClient({
      subject:
        "CN=Pablo Move,2.5.4.5=IDCES-12345678Z,2.5.4.42=Pablo,SN=Move,C=ES",
    });
    const first = await startCertificateLogin({
      municipalityId: "muni-exemplo",
      returnTo: "/c/exemplo",
    });
    const st1 = new URL(first.redirectUrl).searchParams.get("state")!;
    const cb1 = await app.request(`/auth/cert/callback?state=${st1}`, {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "SUCCESS",
        "X-PA-Cert": encodeURIComponent(pem),
      },
      redirect: "manual",
    });
    const ticket1 = new URL(cb1.headers.get("location")!).searchParams.get(
      "ticket",
    )!;
    await app.request(`/auth/cert/finish?ticket=${ticket1}`, {
      redirect: "manual",
      headers: { Cookie: `pa_cert_state=${st1}` },
    });
    const afterFirst = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/12345678Z"))
      .limit(1);
    assert.equal(afterFirst[0]?.municipalityId, "muni-exemplo");

    const second = await startCertificateLogin({
      municipalityId: "muni-proba",
      returnTo: "/c/proba",
    });
    const st2 = new URL(second.redirectUrl).searchParams.get("state")!;
    const cb2 = await app.request(`/auth/cert/callback?state=${st2}`, {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "SUCCESS",
        "X-PA-Cert": encodeURIComponent(pem),
      },
      redirect: "manual",
    });
    const ticket2 = new URL(cb2.headers.get("location")!).searchParams.get(
      "ticket",
    )!;
    const finish2 = await app.request(`/auth/cert/finish?ticket=${ticket2}`, {
      redirect: "manual",
      headers: { Cookie: `pa_cert_state=${st2}` },
    });
    assert.equal(finish2.status, 302);
    assert.match(finish2.headers.get("location") ?? "", /\/c\/proba/);
    const afterSecond = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/12345678Z"))
      .limit(1);
    assert.equal(afterSecond[0]?.municipalityId, "muni-proba");
    assert.equal(afterSecond[0]?.role, "citizen");
  });

  it("admin existente: login cert noutro concello NON move a casa", async () => {
    // 22334455 % 23 = 6 → Y
    const adminPem = await issueClient({
      subject:
        "CN=Admin Sticky,2.5.4.5=IDCES-22334455Y,2.5.4.42=Admin,SN=Sticky,C=ES",
    });
    /* Primeiro login crea cidadán; forzámos rol admin + casa Exemplo. */
    const first = await startCertificateLogin({ municipalityId: "muni-exemplo" });
    const st1 = new URL(first.redirectUrl).searchParams.get("state")!;
    const cb1 = await app.request(`/auth/cert/callback?state=${st1}`, {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "SUCCESS",
        "X-PA-Cert": encodeURIComponent(adminPem),
      },
      redirect: "manual",
    });
    const ticket1 = new URL(cb1.headers.get("location")!).searchParams.get(
      "ticket",
    )!;
    await app.request(`/auth/cert/finish?ticket=${ticket1}`, {
      redirect: "manual",
      headers: { Cookie: `pa_cert_state=${st1}` },
    });
    await getDb()
      .update(t.users)
      .set({ role: "admin", municipalityId: "muni-exemplo" })
      .where(eq(t.users.personIdentifier, "ES/ES/22334455Y"));

    const second = await startCertificateLogin({
      municipalityId: "muni-proba",
      returnTo: "/c/proba",
    });
    const st2 = new URL(second.redirectUrl).searchParams.get("state")!;
    const cb2 = await app.request(`/auth/cert/callback?state=${st2}`, {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "SUCCESS",
        "X-PA-Cert": encodeURIComponent(adminPem),
      },
      redirect: "manual",
    });
    assert.equal(cb2.status, 302);
    const after = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, "ES/ES/22334455Y"))
      .limit(1);
    assert.equal(after[0]?.municipalityId, "muni-exemplo");
    assert.equal(after[0]?.role, "admin");
  });

  it("REVISION-50 S5: finish sen cookie state → ticket inválido", async () => {
    const pem = await issueClient({
      subject:
        "CN=State Cookie,2.5.4.5=IDCES-77777777V,2.5.4.42=State,SN=Cookie,C=ES",
    });
    const { redirectUrl, state } = await startCertificateLogin({
      municipalityId: "muni-exemplo",
    });
    assert.ok(state);
    const st = new URL(redirectUrl).searchParams.get("state")!;
    const cb = await app.request(`/auth/cert/callback?state=${st}`, {
      headers: {
        "X-PA-Gateway-Auth": process.env.CERT_GATEWAY_SECRET!,
        "X-PA-Cert-Verify": "SUCCESS",
        "X-PA-Cert": encodeURIComponent(pem),
      },
      redirect: "manual",
    });
    const ticket = new URL(cb.headers.get("location")!).searchParams.get(
      "ticket",
    )!;
    const noCookie = await app.request(`/auth/cert/finish?ticket=${ticket}`, {
      redirect: "manual",
    });
    assert.match(noCookie.headers.get("location") ?? "", /motivo=ticket/);
  });
});
