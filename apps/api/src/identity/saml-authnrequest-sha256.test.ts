/**
 * Cl@ve real esixe AuthnRequest firmadas con rsa-sha256 (non sha1).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  getSpAuthorizeUrl,
  getSpMetadataXml,
  resetSamlSpForTests,
} from "./saml-sp.js";

const RSA_SHA256 =
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const DIGEST_SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const DIGEST_SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";

describe("SAML AuthnRequest SHA-256 (Cl@ve)", () => {
  before(() => {
    resetSamlSpForTests();
  });

  it("a AuthnRequest firmada leva SigAlg rsa-sha256 e non sha1", async () => {
    const url = await getSpAuthorizeUrl("/c/exemplo");
    const parsed = new URL(url);
    const sigAlg = parsed.searchParams.get("SigAlg") ?? "";
    assert.ok(parsed.searchParams.get("SAMLRequest"), "SAMLRequest presente");
    assert.ok(parsed.searchParams.get("Signature"), "Signature presente");
    assert.equal(sigAlg, RSA_SHA256);
    assert.notEqual(sigAlg, RSA_SHA1);
    assert.doesNotMatch(sigAlg, /rsa-sha1$/);

    /* Metadata do SP asinada tamén con SHA-256. */
    const meta = getSpMetadataXml();
    assert.match(meta, /SignatureMethod[^>]*Algorithm=["'][^"']*rsa-sha256/);
    assert.doesNotMatch(meta, new RegExp(RSA_SHA1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(meta, new RegExp(DIGEST_SHA256.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(meta, new RegExp(DIGEST_SHA1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
