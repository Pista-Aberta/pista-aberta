/**
 * REVISION-26 G3 / REVISION-28 X2 — comprobación OCSP na API (concello con Caddy sen ssl_ocsp).
 * Usa `openssl ocsp` contra a URI AIA do certificado.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CertParseError } from "./certificate.js";

/** Mensaxe fail-closed (REVISIÓN-28 X2). */
export const CERT_OCSP_FAIL_MESSAGE =
  "Non se puido comprobar o certificado; téntao de novo ou usa Cl@ve";

const OCSP_CACHE_TTL_MS = 10 * 60 * 1000;
const ocspGoodBySerial = new Map<string, number>();

/** Normaliza PEM escapado / DER base64 como parseClientCert. */
function normalizePemInput(pemOrEscaped: string): string {
  let pem = pemOrEscaped.trim();
  try {
    pem = decodeURIComponent(pem);
  } catch {
    /* xa sen escapar */
  }
  if (!pem.includes("BEGIN CERTIFICATE")) {
    const compact = pem.replace(/\s+/g, "");
    if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 80) {
      const der = Buffer.from(compact, "base64");
      const b64 = der.toString("base64");
      pem = `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)?.join("\n") ?? b64}\n-----END CERTIFICATE-----`;
    } else {
      pem = `-----BEGIN CERTIFICATE-----\n${pem.replace(/\s+/g, "\n")}\n-----END CERTIFICATE-----`;
    }
  }
  return pem;
}

function isOcspRequired(): boolean {
  return (process.env.CERT_OCSP_REQUIRED ?? "").toLowerCase() === "1";
}

function ocspUnavailableError(): CertParseError {
  return new CertParseError("cert_ocsp_erro", CERT_OCSP_FAIL_MESSAGE);
}

function opensslAvailable(): boolean {
  const r = spawnSync("openssl", ["version"], { encoding: "utf8", timeout: 5_000 });
  return r.status === 0;
}

function runOpenssl(args: string[], input?: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("openssl", args, {
    input,
    encoding: "utf8",
    timeout: 12_000,
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function dnFromX509(pem: string, field: "issuer" | "subject"): string | null {
  const r = runOpenssl(["x509", "-noout", `-${field}`, "-nameopt", "RFC2253,-space_eq"], pem);
  if (r.status !== 0) return null;
  const line = r.stdout.trim().split("\n").filter(Boolean)[0] ?? "";
  const prefix = `${field}=`;
  if (!line.toLowerCase().startsWith(prefix)) return null;
  return line.slice(prefix.length).trim();
}

function extensionKeyIdHex(pem: string, ext: "authorityKeyIdentifier" | "subjectKeyIdentifier"): string | null {
  const r = runOpenssl(["x509", "-noout", "-ext", ext], pem);
  if (r.status !== 0) return null;
  const text = `${r.stdout}\n${r.stderr}`;
  const m = text.match(/(?:keyid:|Subject Key Identifier:\s*\n?\s*)([0-9A-Fa-f:]+)/i);
  if (!m?.[1]) return null;
  return m[1].replace(/:/g, "").toUpperCase();
}

function splitPemBundle(bundle: string): string[] {
  const re = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  return bundle.match(re) ?? [];
}

function resolveTrustedCaBundlePath(): string | null {
  const env = process.env.CERT_OCSP_CA_BUNDLE?.trim();
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    path.resolve(process.cwd(), "deploy/dominio/ca/trusted-client-cas.official.pem"),
    path.resolve(process.cwd(), "../../deploy/dominio/ca/trusted-client-cas.official.pem"),
    "/etc/pa/trusted-client-cas.official.pem",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveIssuerCaOverride(): string | null {
  const env = process.env.CERT_OCSP_CA?.trim();
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    path.resolve(process.cwd(), "deploy/demo-ca/demo-ca.pem"),
    path.resolve(process.cwd(), "../../deploy/demo-ca/demo-ca.pem"),
    "/ca/demo-ca.pem",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Emisor do certificado: override CERT_OCSP_CA ou match no paquete oficial por Issuer / AKI. */
function resolveIssuerCa(leafPem: string): { issuerPem: string; caFile: string } | null {
  const override = resolveIssuerCaOverride();
  if (override) {
    return { issuerPem: override, caFile: override };
  }

  const bundlePath = resolveTrustedCaBundlePath();
  if (!bundlePath) return null;

  const leafIssuer = dnFromX509(leafPem, "issuer");
  if (!leafIssuer) return null;
  const leafAki = extensionKeyIdHex(leafPem, "authorityKeyIdentifier");

  const bundle = fs.readFileSync(bundlePath, "utf8");
  const matches: string[] = [];
  for (const caPem of splitPemBundle(bundle)) {
    const subj = dnFromX509(caPem, "subject");
    if (subj && subj === leafIssuer) matches.push(caPem);
  }
  if (matches.length === 0) return null;

  let chosen = matches[0]!;
  if (matches.length > 1 && leafAki) {
    for (const caPem of matches) {
      const ski = extensionKeyIdHex(caPem, "subjectKeyIdentifier");
      if (ski && ski === leafAki) {
        chosen = caPem;
        break;
      }
    }
  }

  return { issuerPem: chosen, caFile: bundlePath };
}

function extractOcspUri(pem: string): string | null {
  const r = runOpenssl(["x509", "-noout", "-ocsp_uri"], pem);
  if (r.status !== 0) return null;
  const uri = (r.stdout ?? "").trim().split("\n").filter(Boolean)[0];
  return uri || null;
}

function rewriteOcspUri(uri: string): string {
  const map = process.env.CERT_OCSP_URL_REWRITE?.trim();
  if (!map) {
    // Demo compose: pa-ocsp-demo só resolve dentro da rede Docker.
    if (uri.includes("pa-ocsp-demo")) {
      return uri.replace("pa-ocsp-demo", "127.0.0.1");
    }
    return uri;
  }
  const eq = map.indexOf("=");
  if (eq < 0) return uri;
  const from = map.slice(0, eq);
  const to = map.slice(eq + 1);
  return uri.split(from).join(to);
}

function extractSerialHex(pem: string): string | null {
  const r = runOpenssl(["x509", "-noout", "-serial"], pem);
  if (r.status !== 0) return null;
  const m = (r.stdout ?? "").match(/serial=([0-9A-Fa-f]+)/i);
  return m?.[1]?.toUpperCase() ?? null;
}

function resolveOcspIndex(): string | null {
  const env = process.env.CERT_OCSP_INDEX?.trim();
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    path.resolve(process.cwd(), "deploy/demo-ca/index.txt"),
    path.resolve(process.cwd(), "../../deploy/demo-ca/index.txt"),
    "/ca/index.txt",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Fallback demo CA: liñas «R» no index.txt de openssl ca. */
function assertNotRevokedInIndex(pem: string): void {
  const index = resolveOcspIndex();
  const serial = extractSerialHex(pem);
  if (!index || !serial) return;
  const text = fs.readFileSync(index, "utf8");
  for (const line of text.split("\n")) {
    if (!line.startsWith("R\t") && !line.startsWith("R ")) continue;
    if (line.toUpperCase().includes(serial)) {
      throw new CertParseError("cert_revogado", "Certificado revogado (CA index)");
    }
  }
}

function cachedOcspGood(serial: string): boolean {
  const exp = ocspGoodBySerial.get(serial);
  if (exp == null) return false;
  if (Date.now() > exp) {
    ocspGoodBySerial.delete(serial);
    return false;
  }
  return true;
}

function rememberOcspGood(serial: string): void {
  ocspGoodBySerial.set(serial, Date.now() + OCSP_CACHE_TTL_MS);
}

/**
 * Se CERT_OCSP_CHECK=0 → no-op.
 * Se CERT_OCSP_REQUIRED=1 → fail-closed coa mensaxe en galego.
 * Se openssl responde «revoked» → cert_revogado.
 * Fallback: index.txt da CA de proba (demo).
 */
export function assertCertOcspGood(pemOrEscaped: string): void {
  const flag = (process.env.CERT_OCSP_CHECK ?? "1").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return;

  const pem = normalizePemInput(pemOrEscaped);
  const serial = extractSerialHex(pem);

  if (serial && cachedOcspGood(serial)) return;

  try {
    assertNotRevokedInIndex(pem);
  } catch (e) {
    if (e instanceof CertParseError) throw e;
  }

  if (!opensslAvailable()) {
    if (isOcspRequired()) throw ocspUnavailableError();
    return;
  }

  const uriRaw = extractOcspUri(pem);
  if (!uriRaw) {
    if (isOcspRequired()) throw ocspUnavailableError();
    return;
  }

  const issuer = resolveIssuerCa(pem);
  if (!issuer) {
    if (isOcspRequired()) throw ocspUnavailableError();
    return;
  }

  const uri = rewriteOcspUri(uriRaw);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-ocsp-"));
  const certPath = path.join(dir, "leaf.pem");
  const issuerPath = path.join(dir, "issuer.pem");
  try {
    fs.writeFileSync(certPath, pem);
    fs.writeFileSync(issuerPath, issuer.issuerPem);
    const r = spawnSync(
      "openssl",
      [
        "ocsp",
        "-issuer",
        issuerPath,
        "-cert",
        certPath,
        "-url",
        uri,
        "-CAfile",
        issuer.caFile,
        "-timeout",
        "5",
      ],
      { encoding: "utf8", timeout: 12_000 },
    );
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.toLowerCase();
    if (out.includes("revoked")) {
      throw new CertParseError("cert_revogado", "Certificado revogado (OCSP)");
    }
    /* DNIe: resposta firmada por respondedor delegado — require verify OK + good.
     * Probar con FNMT e DNIe reais antes do 10/11 (demo). */
    const ocspOk = out.includes("good") && out.includes("response verify ok");
    if (!ocspOk) {
      if (isOcspRequired()) throw ocspUnavailableError();
      return;
    }
    if (serial) rememberOcspGood(serial);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Só para tests: limpar caché OCSP. */
export function clearOcspCacheForTests(): void {
  ocspGoodBySerial.clear();
}
