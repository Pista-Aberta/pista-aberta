/**
 * Proteccións de arranque (REVISION-2 §2–§3 / REVISION-23 R1).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

describe("env guards", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    process.env = { ...prev };
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it("REVISION-25 N1: production cos PEM de demo sen SAML configurado → non falla", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.PA_DEMO;
    delete process.env.SAML_ALLOW_DEMO_CERTS;
    delete process.env.SAML_IDP_SSO_URL;
    delete process.env.SAML_CERTS_DIR;
    process.env.SESSION_SECRET = "production-session-secret-long-enough-32";
    process.env.CERT_LOGIN_ENABLED = "1";
    process.env.CERT_GATEWAY_SECRET = "production-cert-gateway-secret-32chars";
    const { assertProductionSafe } = await import("./env.js");
    assert.doesNotThrow(() => assertProductionSafe());
  });

  it("REVISION-25 N1: production + SAML configurado + PEM demo → assertProductionSafe falla", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.PA_DEMO;
    delete process.env.SAML_ALLOW_DEMO_CERTS;
    process.env.SAML_IDP_SSO_URL = "https://clave.example.org/sso";
    process.env.SESSION_SECRET = "production-session-secret-long-enough-32";
    process.env.CERT_LOGIN_ENABLED = "0";
    const { assertProductionSafe } = await import("./env.js");
    assert.throws(() => assertProductionSafe(), /certificados SAML de demo/);
  });

  it("requireCertGatewaySecret: default só en NODE_ENV=test", async () => {
    const { requireCertGatewaySecret } = await import("./env.js");
    process.env.NODE_ENV = "test";
    delete process.env.CERT_GATEWAY_SECRET;
    assert.equal(
      requireCertGatewaySecret(),
      "test-cert-gateway-secret-32chars!!",
    );

    process.env.NODE_ENV = "demo";
    process.env.PA_DEMO = "1";
    process.env.CERT_LOGIN_ENABLED = "1";
    delete process.env.CERT_GATEWAY_SECRET;
    assert.throws(() => requireCertGatewaySecret(), /CERT_GATEWAY_SECRET/);
  });

  it("REVISION-23 R1: NODE_ENV=production + PA_DEMO=1 bloquea arranque", async () => {
    process.env.NODE_ENV = "production";
    process.env.PA_DEMO = "1";
    process.env.SESSION_SECRET = "production-session-secret-long-enough-32";
    process.env.CERT_LOGIN_ENABLED = "0";
    process.env.SAML_ALLOW_DEMO_CERTS = "1";
    const { assertProductionSafe } = await import("./env.js");
    assert.throws(() => assertProductionSafe(), /PA_DEMO=1/);
  });
});
