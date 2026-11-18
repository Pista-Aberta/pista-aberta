import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDir = path.resolve(here, "../../certs");

export function certsDir(): string {
  return process.env.SAML_CERTS_DIR?.trim() || defaultDir;
}

/** Xera PEM self-signed de demo se faltan (dev / install). */
export function ensureDemoSamlCerts(): void {
  const dir = certsDir();
  fs.mkdirSync(dir, { recursive: true });
  const pairs: Array<[string, string, string]> = [
    ["idp-key.pem", "idp-cert.pem", "Pista Aberta IdP Mock"],
    ["sp-key.pem", "sp-cert.pem", "Pista Aberta SP Demo"],
  ];
  for (const [keyName, certName, cn] of pairs) {
    const keyPath = path.join(dir, keyName);
    const certPath = path.join(dir, certName);
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) continue;
    const r = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "825",
        "-subj",
        `/CN=${cn}/O=Demo/C=ES`,
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error(
        `Non se puideron xerar certs SAML en ${dir}: ${r.stderr || r.stdout || "openssl fallou"}`,
      );
    }
    try {
      fs.chmodSync(keyPath, 0o600);
    } catch {
      /* ignore */
    }
  }
}

export function readPem(name: string): string {
  ensureDemoSamlCerts();
  const p = path.join(certsDir(), name);
  return fs.readFileSync(p, "utf8");
}

/** Certificado sen cabeceiras PEM (formato que espera node-saml en idpCert). */
export function pemBody(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
}

export function loadIdpKey(): string {
  return readPem("idp-key.pem");
}

export function loadIdpCert(): string {
  return readPem("idp-cert.pem");
}

export function loadSpKey(): string {
  return readPem("sp-key.pem");
}

export function loadSpCert(): string {
  return readPem("sp-cert.pem");
}
