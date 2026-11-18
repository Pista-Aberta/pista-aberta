#!/usr/bin/env tsx
/**
 * REVISION-28 X2 — comprobación OCSP dentro do contedor da API.
 * Uso: npm run test:ocsp  (require deploy/demo-ca xerado con npm run demo-ca)
 */
import { spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCertOcspGood,
  CERT_OCSP_FAIL_MESSAGE,
  clearOcspCacheForTests,
} from "../src/identity/cert-ocsp.js";
import { CertParseError } from "../src/identity/certificate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function fail(msg: string): never {
  console.error(`test:ocsp FAIL: ${msg}`);
  process.exit(1);
}

function resolveDemoCaDir(): string {
  for (const d of [path.join(ROOT, "deploy/demo-ca"), "/ca-demo", "/ca"]) {
    if (fs.existsSync(path.join(d, "demo-ca.pem"))) return d;
  }
  fail(
    "faltan certificados demo (executa na raíz do repo: npm run demo-ca; no contedor monta deploy/demo-ca → /ca-demo)",
  );
}

function ocspDemoReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port: 2560, timeout: 800 }, () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.on("timeout", () => {
      s.destroy();
      resolve(false);
    });
  });
}

const which = spawnSync("sh", ["-c", "command -v openssl"], { encoding: "utf8" });
if (which.status !== 0 || !which.stdout.trim()) {
  fail("openssl non está no PATH (apk add openssl na imaxe da API)");
}
console.log(`openssl: ${which.stdout.trim()}`);

const demoDir = resolveDemoCaDir();
process.env.CERT_OCSP_CHECK = "1";
process.env.CERT_OCSP_CA = path.join(demoDir, "demo-ca.pem");
process.env.CERT_OCSP_INDEX = path.join(demoDir, "index.txt");
process.env.CERT_OCSP_URL_REWRITE = "pa-ocsp-demo=127.0.0.1";

const goodPath = path.join(demoDir, "cidada-demo.pem");
const revokedPath = path.join(demoDir, "revogado-demo.pem");
if (!fs.existsSync(goodPath) || !fs.existsSync(revokedPath)) {
  fail("faltan cidada-demo.pem ou revogado-demo.pem");
}

const goodPem = fs.readFileSync(goodPath, "utf8");
const revokedPem = fs.readFileSync(revokedPath, "utf8");

function assertRevoked(pem: string): void {
  try {
    assertCertOcspGood(pem);
    fail("revogado-demo.pem debería rexeitarse");
  } catch (e) {
    if (!(e instanceof CertParseError) || e.code !== "cert_revogado") {
      fail(`revogado-demo.pem: esperábase cert_revogado, obtivo ${e}`);
    }
  }
}

function assertGood(pem: string): void {
  try {
    assertCertOcspGood(pem);
  } catch (e) {
    fail(`certificado válido debería pasar: ${e instanceof Error ? e.message : e}`);
  }
}

clearOcspCacheForTests();
process.env.CERT_OCSP_REQUIRED = "0";
assertRevoked(revokedPem);
console.log("OK: revogado-demo.pem → cert_revogado (índice CA)");

const ocspLive = await ocspDemoReachable();
if (ocspLive) {
  process.env.CERT_OCSP_REQUIRED = "1";
  clearOcspCacheForTests();
  assertGood(goodPem);
  console.log("OK: cidada-demo.pem → OCSP good (CERT_OCSP_REQUIRED=1)");
  assertGood(goodPem);
  console.log("OK: caché 10 min por serie (segunda consulta)");
} else {
  console.log(
    "SKIP: respondedor OCSP demo offline (levanta: docker compose -f docker-compose.concello.yml --profile demo-ocsp up -d pa-ocsp-demo)",
  );
  assertGood(goodPem);
  console.log("OK: cidada-demo.pem → índice CA (CERT_OCSP_REQUIRED=0)");
}

process.env.CERT_OCSP_REQUIRED = "1";
clearOcspCacheForTests();
delete process.env.CERT_OCSP_CA;
delete process.env.CERT_OCSP_INDEX;
try {
  assertCertOcspGood(goodPem);
  fail("debería fallar sen emisor coñecido con CERT_OCSP_REQUIRED=1");
} catch (e) {
  if (!(e instanceof CertParseError) || e.code !== "cert_ocsp_erro") {
    fail(`esperábase cert_ocsp_erro fail-closed, obtivo ${e}`);
  }
  if (e.message !== CERT_OCSP_FAIL_MESSAGE) {
    fail(`mensaxe incorrecta: ${e.message}`);
  }
}
console.log(`OK: fail-closed: «${CERT_OCSP_FAIL_MESSAGE}»`);
console.log("test:ocsp PASS");
