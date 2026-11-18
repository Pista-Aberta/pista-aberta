import { createHash, X509Certificate } from "node:crypto";
import { loadIdpCert, loadSpCert } from "./identity/saml-certs.js";

/**
 * Flags de entorno — demo vs prod.
 * Demo: PA_DEMO=1 explícito. NODE_ENV=test conserva os fixtures automatizados.
 */
export function isDemoMode(): boolean {
  if (process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true") return true;
  return (process.env.NODE_ENV ?? "").toLowerCase() === "test";
}

/**
 * Demo baleira (PA_DEMO_EMPTY=1): en modo demo arranca só coa plataforma,
 * a Deputación e o superadmin, sen semear concellos nin datos de proba.
 */
export function isDemoEmptyMode(): boolean {
  if (!isDemoMode()) return false;
  const v = (process.env.PA_DEMO_EMPTY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Reseteo nocturno ás 04:00 Europe/Madrid.
 * DEMO_NIGHTLY_RESET=0 desactívao por completo (por defecto activo).
 */
export function isDemoNightlyResetEnabled(): boolean {
  const v = (process.env.DEMO_NIGHTLY_RESET ?? "1").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}

/**
 * REVISION-22 A8 — instalación dun só concello.
 * PA_SINGLE_MUNI ou VITE_PA_SINGLE_MUNI = slug (p.ex. «mi-concello»).
 */
export function getSingleMuniSlug(): string | null {
  const raw =
    process.env.PA_SINGLE_MUNI?.trim() ||
    process.env.VITE_PA_SINGLE_MUNI?.trim() ||
    "";
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return slug || null;
}

export function isProduction(): boolean {
  return (process.env.NODE_ENV ?? "").toLowerCase() === "production" && !isDemoMode();
}

/**
 * Pegadas SHA-256 (hex minúscula sen ':') dos PEM de demo do repo
 * (apps/api/certs/idp-cert.pem e sp-cert.pem).
 */
export const DEMO_SAML_CERT_FINGERPRINTS = new Set([
  "c14f3d5cb184fab7e5b0f152d2b2638e519b2773454d078cb3f525b511d56617",
  "f66a4930fcbb8b50d5c500011594d262ce9a934ff43e21e08b4e760a41696476",
]);

function pemSha256Fingerprint(pem: string): string {
  const cert = new X509Certificate(pem);
  return createHash("sha256").update(cert.raw).digest("hex");
}

function pemLooksLikeDemo(pem: string): boolean {
  try {
    const fp = pemSha256Fingerprint(pem);
    if (DEMO_SAML_CERT_FINGERPRINTS.has(fp)) return true;
    const cert = new X509Certificate(pem);
    const subject = cert.subject;
    return /Demo GOBTEC|IdP Mock|SP Demo|Pista Aberta IdP Mock|Pista Aberta SP Demo/i.test(
      subject,
    );
  } catch {
    return false;
  }
}

const DEFAULT_SESSION_SECRET = "pista-aberta-demo-secret";

/** Cookie Secure cando hai HTTPS explícito ou APP_BASE_URL https. */
export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "1" || process.env.COOKIE_SECURE === "true") {
    return true;
  }
  if (process.env.COOKIE_SECURE === "0" || process.env.COOKIE_SECURE === "false") {
    return false;
  }
  const base = process.env.APP_BASE_URL ?? "";
  return base.startsWith("https://");
}

/**
 * Segredo HMAC (sesións / QR).
 * En prod falla se falta; en demo/test permite default.
 */
export function requireSessionSecret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (s) return s;
  /*
   * Só producción esixe SESSION_SECRET. Demo/test/dev local poden usar o
   * default; isto evita que mutacións temporais de NODE_ENV nos tests
   * paralelos (p.ex. P3.9) rompan suites alleas.
   */
  if (!isProduction()) {
    return DEFAULT_SESSION_SECRET;
  }
  throw new Error(
    "SESSION_SECRET ausente: obrigatorio en produción (NODE_ENV=production)",
  );
}

/** SAML validateInResponseTo: never (demo) | always (prod). Override: SAML_VALIDATE_IN_RESPONSE_TO */
export function samlValidateInResponseToMode(): "never" | "always" {
  const v = (process.env.SAML_VALIDATE_IN_RESPONSE_TO ?? "").toLowerCase();
  if (v === "always" || v === "never") return v;
  return isProduction() ? "always" : "never";
}

/** Confiar rol do assertion SAML? Só demo explícito. Prod: nunca. */
export function trustSamRoleAttribute(): boolean {
  if (isProduction()) return false;
  return process.env.PA_TRUST_SAML_ROLE === "1";
}

/**
 * Staff/admin/monitor/club: en produción (ou AUTH_ELEVATED_SAML_ONLY=1)
 * o OTP non eleva — só SAML/Cl@ve.
 */
export function elevatedRolesRequireSaml(): boolean {
  if (process.env.AUTH_ELEVATED_SAML_ONLY === "1") return true;
  if (process.env.AUTH_ELEVATED_SAML_ONLY === "0") return false;
  return isProduction();
}

/**
 * Abortar arranque se NODE_ENV=production con configuración demo insegura.
 * Demo VPS usa NODE_ENV=demo + PA_DEMO=1 (non pasa por aquí).
 */
/** Acceso con certificado dixital (mTLS vía nginx cert.*). */
export function isCertLoginEnabled(): boolean {
  const v = (process.env.CERT_LOGIN_ENABLED ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** REVISION-60 M3 — confiar en X-Forwarded-For (último salto) / X-Real-IP só detrás de proxy propio. */
export function isTrustProxy(): boolean {
  const v = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** REVISION-25 N1 — Cl@ve/SAML activo (non o mock por defecto da imaxe). */
export function isSamlLoginConfigured(): boolean {
  if (process.env.SAML_IDP_SSO_URL?.trim()) return true;
  if (process.env.SAML_IDP_ENTITY_ID?.trim()) return true;
  if (process.env.SAML_SP_ENTITY_ID?.trim()) return true;
  if (process.env.SAML_CALLBACK_URL?.trim()) return true;
  if (process.env.SAML_CERTS_DIR?.trim()) return true;
  return false;
}

/** REVISION-60 N11 — Cl@ve real configurada (IdP externo distinto de /auth/saml/mock-idp). */
export function isRealClaveConfigured(): boolean {
  const sso = process.env.SAML_IDP_SSO_URL?.trim() ?? "";
  const entity = process.env.SAML_IDP_ENTITY_ID?.trim() ?? "";
  if (sso && !sso.includes("/auth/saml/mock-idp")) return true;
  if (entity && !entity.includes("/auth/saml/mock-idp")) return true;
  return false;
}

/** O IdP mock só está dispoñible en modo demo e mentres non haxa Cl@ve real configurada. */
export function isMockIdpEnabled(): boolean {
  if (isRealClaveConfigured()) return false;
  return isDemoMode();
}

/** Só e2e/laboratorio: AC de demo no host mTLS con NODE_ENV=production. */
export function certAllowDemoCa(): boolean {
  const v = (process.env.CERT_ALLOW_DEMO_CA ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Segredo compartido nginx↔API (cabeceira X-PA-Gateway-Auth).
 * Default só en NODE_ENV=test. Con CERT_LOGIN_ENABLED=1 esixe ≥32 chars
 * en calquera outro entorno (demo/prod).
 */
export function requireCertGatewaySecret(): string {
  const s = process.env.CERT_GATEWAY_SECRET?.trim() ?? "";
  if (s.length >= 32) return s;
  if (process.env.NODE_ENV === "test") {
    return "test-cert-gateway-secret-32chars!!";
  }
  if (isCertLoginEnabled()) {
    throw new Error(
      "CERT_GATEWAY_SECRET ausente ou curto (<32) con CERT_LOGIN_ENABLED",
    );
  }
  if (s) return s;
  throw new Error("CERT_GATEWAY_SECRET ausente");
}

export function assertProductionSafe(): void {
  const nodeEnv = (process.env.NODE_ENV ?? "").toLowerCase();
  if (nodeEnv !== "production") return;

  if (process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true") {
    throw new Error(
      "Arranque bloqueado: NODE_ENV=production incompatíbel con PA_DEMO=1. Usa NODE_ENV=demo para a demo.",
    );
  }

  if (isCertLoginEnabled()) {
    const gw = process.env.CERT_GATEWAY_SECRET?.trim() ?? "";
    if (gw.length < 32) {
      throw new Error(
        "Arranque bloqueado: CERT_LOGIN_ENABLED=1 require CERT_GATEWAY_SECRET ≥32 caracteres.",
      );
    }
  }

  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  if (!secret || secret === DEFAULT_SESSION_SECRET || secret === "change-me-long-random") {
    throw new Error(
      "Arranque bloqueado: SESSION_SECRET débil ou por defecto en produción.",
    );
  }

  if (!isSamlLoginConfigured()) {
    console.info("[boot] Cl@ve sen configurar");
    return;
  }

  if (process.env.SAML_ALLOW_DEMO_CERTS === "1") return;

  try {
    const idp = loadIdpCert();
    const sp = loadSpCert();
    if (pemLooksLikeDemo(idp) || pemLooksLikeDemo(sp)) {
      throw new Error(
        "Arranque bloqueado: certificados SAML de demo detectados en produción. " +
          "Substitúe os PEM ou define SAML_ALLOW_DEMO_CERTS=1 só en laboratorio.",
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Arranque bloqueado")) throw e;
    // Certs ausentes: OK se o despregue real os monta despois; SAML fallará ao usar.
  }
}
