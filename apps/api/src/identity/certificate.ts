/**
 * Análise de certificado de cliente (mTLS).
 * A API nunca le o cert do navegador: só o PEM que envía nginx tras validar cadea+OCSP.
 */
import "reflect-metadata";
import * as x509 from "@peculiar/x509";

const OID = {
  serialNumber: "2.5.4.5",
  givenName: "2.5.4.42",
  surname: "2.5.4.4",
  commonName: "2.5.4.3",
  organizationIdentifier: "2.5.4.97",
  organization: "2.5.4.10",
} as const;

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** CN da AC de demo — rexeitar en produción / sen PA_DEMO. */
export const DEMO_CA_CN = "Pista Aberta DEMO CA - NON VALIDA";

export interface CertIdentity {
  nif: string;
  personIdentifier: string;
  givenName: string;
  surname: string;
  displayName: string;
  issuerCN: string;
  serialHex: string;
  notAfter: Date;
  representative?: { cif: string; organization: string };
}

export class CertParseError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CertParseError";
  }
}

export function normalizeNif(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/\s+/g, "");
  s = s.replace(/^IDCES-?/, "");
  return s;
}

export function validateNifLetter(nif: string): boolean {
  const m = nif.toUpperCase().match(/^([XYZ]?)(\d{7,8})([A-Z])$/);
  if (!m) return false;
  const prefix = m[1] ?? "";
  const digits = m[2]!;
  const letter = m[3]!;
  let numStr = digits;
  if (prefix === "X") numStr = "0" + digits.slice(-7);
  else if (prefix === "Y") numStr = "1" + digits.slice(-7);
  else if (prefix === "Z") numStr = "2" + digits.slice(-7);
  else numStr = digits.padStart(8, "0");
  const n = Number.parseInt(numStr, 10);
  if (!Number.isFinite(n)) return false;
  return DNI_LETTERS[n % 23] === letter;
}

/** Lee un atributo DN por OID ou short name (CN, G, SN…). */
function attrValue(name: x509.Name, oidOrShort: string): string | undefined {
  try {
    const vals = name.getField(oidOrShort);
    if (vals?.length && typeof vals[0] === "string") return vals[0];
  } catch {
    // OID descoñecido
  }
  return undefined;
}

function hasDigitalSignature(ku: x509.KeyUsagesExtension | null): boolean {
  if (!ku) return false;
  return (ku.usages & x509.KeyUsageFlags.digitalSignature) !== 0;
}

function ekuOk(eku: x509.ExtendedKeyUsageExtension | null): boolean {
  if (!eku) return true;
  const usages = eku.usages;
  return (
    usages.includes("1.3.6.1.5.5.7.3.2") || // clientAuth
    usages.includes("1.3.6.1.5.5.7.3.4") // emailProtection
  );
}

/** Maiúsculas do DN → nome propio (locale es/gl). */
export function toProperName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return s;
  return s
    .toLocaleLowerCase("es")
    .replace(/(^|[\s\-'])\p{L}/gu, (ch) => ch.toLocaleUpperCase("es"));
}

/**
 * Parsea o PEM escapado de `$ssl_client_escaped_cert` ou DER base64 (Caddy).
 */
export function parseClientCert(pemOrEscaped: string, now = new Date()): CertIdentity {
  let pem = pemOrEscaped.trim();
  try {
    pem = decodeURIComponent(pem);
  } catch {
    // xa pode vir sen escapar
  }
  if (!pem.includes("BEGIN CERTIFICATE")) {
    const compact = pem.replace(/\s+/g, "");
    if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 80) {
      const der = Buffer.from(compact, "base64");
      const b64 = der.toString("base64");
      pem = `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)?.join("\n") ?? b64}\n-----END CERTIFICATE-----`;
    } else {
      // nginx escaped_cert ás veces sen cabeceiras
      pem = `-----BEGIN CERTIFICATE-----\n${pem.replace(/\s+/g, "\n")}\n-----END CERTIFICATE-----`;
    }
  }

  let cert: x509.X509Certificate;
  try {
    cert = new x509.X509Certificate(pem);
  } catch {
    throw new CertParseError("cert_invalido", "PEM non válido");
  }

  if (now < cert.notBefore || now > cert.notAfter) {
    throw new CertParseError("cert_caducado", "Certificado fóra de validez");
  }

  const ku = cert.getExtension(x509.KeyUsagesExtension);
  if (!hasDigitalSignature(ku)) {
    throw new CertParseError("cert_ku", "Falta digitalSignature no Key Usage");
  }
  const eku = cert.getExtension(x509.ExtendedKeyUsageExtension);
  if (!ekuOk(eku)) {
    throw new CertParseError("cert_eku", "EKU non admite clientAuth");
  }

  const subject = cert.subjectName;
  const issuer = cert.issuerName;
  const issuerCN =
    attrValue(issuer, "CN") ??
    attrValue(issuer, OID.commonName) ??
    issuer.toString();

  const serialRaw =
    attrValue(subject, OID.serialNumber) ?? attrValue(subject, "2.5.4.5");
  if (!serialRaw) {
    throw new CertParseError("cert_sen_nif", "Sen serialNumber no DN");
  }
  const nif = normalizeNif(serialRaw);
  if (!validateNifLetter(nif)) {
    throw new CertParseError("cert_sen_nif", "DNI/NIE con letra incorrecta");
  }

  let givenName =
    attrValue(subject, "G") ??
    attrValue(subject, OID.givenName) ??
    "";
  let surname =
    attrValue(subject, "SN") ??
    attrValue(subject, OID.surname) ??
    "";
  const cn =
    attrValue(subject, "CN") ?? attrValue(subject, OID.commonName) ?? "";
  if (!givenName && !surname && cn) {
    const cleaned = cn
      .replace(/\s*-\s*[0-9XYZ]{8,9}[A-Z]?\s*$/i, "")
      .replace(/\(AUTENTICACIÓN\)/gi, "")
      .replace(/\(AUTENTICACION\)/gi, "")
      .trim();
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) {
      givenName = parts[0]!;
      surname = parts.slice(1).join(" ");
    } else {
      givenName = cleaned;
    }
  }

  const rawName =
    [givenName, surname].filter(Boolean).join(" ").trim() || cn || nif;
  /** Nome propio: «Pablo López Núñez», non «LOPEZ NUÑEZ PABLO». */
  const displayName = toProperName(rawName);

  let representative: CertIdentity["representative"];
  const orgId =
    attrValue(subject, OID.organizationIdentifier) ??
    attrValue(subject, "2.5.4.97");
  if (orgId) {
    const cif = orgId.replace(/^VATES-?/i, "").toUpperCase();
    const organization =
      attrValue(subject, "O") ??
      attrValue(subject, OID.organization) ??
      cif;
    representative = { cif, organization };
  }

  return {
    nif,
    personIdentifier: `ES/ES/${nif}`,
    givenName,
    surname,
    displayName,
    issuerCN,
    serialHex: String(cert.serialNumber).replace(/^0x/i, "").toUpperCase(),
    notAfter: cert.notAfter,
    representative,
  };
}

export function isDemoIssuer(issuerCN: string): boolean {
  return issuerCN.includes("DEMO CA") || issuerCN === DEMO_CA_CN;
}

/**
 * Etiqueta curta do emisor para a Conta («Entraches con certificado (FNMT)»).
 * Só cando o podemos recoñecer; se non, null → texto xenérico sen «(FNMT)».
 */
export function shortCertIssuerLabel(issuerCN: string): string | null {
  const s = issuerCN.toLowerCase();
  if (!s.trim()) return null;
  if (s.includes("dnie") || s.includes("dni electr")) return "DNIe";
  if (
    s.includes("fnmt") ||
    s.includes("fábrica nacional") ||
    s.includes("fabrica nacional")
  ) {
    return "FNMT";
  }
  if (s.includes("accv")) return "ACCV";
  if (s.includes("camerfirma")) return "Camerfirma";
  if (s.includes("demo ca")) return "Demo";
  return null;
}
